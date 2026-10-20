/**
 * 条目写入：按分组结果确保条目存在、维护文件 ↔ 条目关联、回收没有文件的条目，
 * 并记录哪些顶层条目新增 / 变化 / 删除，供推送事件使用。
 *
 * 所有方法都应在调用方的事务里执行。
 */
import { type LibraryDb, StatementCache } from '../db/database'
import type { FileGrouping, ItemSeed } from './grouping'

/** 一批写入影响到的顶层条目 id。 */
export class ItemChanges {
  readonly added = new Set<number>()
  readonly updated = new Set<number>()
  readonly removed = new Set<number>()

  /** 标记为变化；本批新增或已删除的不重复记。 */
  touch(id: number): void {
    if (!this.added.has(id) && !this.removed.has(id)) this.updated.add(id)
  }

  /** 是否没有任何变化。 */
  get empty(): boolean {
    return !this.added.size && !this.updated.size && !this.removed.size
  }
}

/** 文件关联到的顶层条目（电影 / 剧集）。 */
const TOP_OF_FILE_SQL = `
SELECT DISTINCT COALESCE(gp.id, p.id, i.id) AS top
FROM file_media fm
JOIN media_items i ON i.id = fm.item_id
LEFT JOIN media_items p ON p.id = i.parent_id
LEFT JOIN media_items gp ON gp.id = p.parent_id
WHERE fm.file_id = ?`

/** 回收某类没有文件、没有子条目、未锁定的条目。 */
const GC_SQL = `
DELETE FROM media_items
WHERE library_id = ? AND type = ? AND match_state <> 'locked'
  AND NOT EXISTS (SELECT 1 FROM file_media fm WHERE fm.item_id = media_items.id)
  AND NOT EXISTS (SELECT 1 FROM media_items c WHERE c.parent_id = media_items.id)
RETURNING id`

/** 条目写入仓库。 */
export class CatalogStore {
  private readonly sql: StatementCache
  /** local_key → id；回收条目后清空。 */
  private readonly ids = new Map<string, number>()

  constructor(db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  /** 确保条目存在，返回 id 与是否新建。 */
  private ensure(
    libraryId: number,
    item: ItemSeed,
    now: number
  ): { id: number; created: boolean } {
    const cached = this.ids.get(item.localKey)
    if (cached !== undefined) return { id: cached, created: false }
    const row = this.sql
      .get('SELECT id FROM media_items WHERE local_key = ?')
      .get(item.localKey)
    if (row) {
      const id = Number(row.id)
      this.ids.set(item.localKey, id)
      return { id, created: false }
    }
    const parentId =
      item.parentKey === null ? null : (this.ids.get(item.parentKey) ?? null)
    const inserted = this.sql
      .get(
        `INSERT INTO media_items (library_id, type, parent_id, local_key, title,
           original_title, sort_title, search_text, year, season_number,
           episode_number, added_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .get(
        libraryId,
        item.type,
        parentId,
        item.localKey,
        item.title,
        item.originalTitle,
        item.sortTitle,
        item.searchText,
        item.year,
        item.seasonNumber,
        item.episodeNumber,
        now,
        now
      )!
    const id = Number(inserted.id)
    this.ids.set(item.localKey, id)
    return { id, created: true }
  }

  /** 文件当前关联到的顶层条目。 */
  topLevelOfFile(fileId: number): number[] {
    return this.sql
      .get(TOP_OF_FILE_SQL)
      .all(fileId)
      .map(r => Number(r.top))
  }

  /**
   * 把文件关联到分组结果的叶子条目，并记录顶层条目变化。
   * isNew 为 true 表示文件刚插入、还没有任何关联，跳过查旧关联。
   * 返回是否解除过旧关联（调用方据此决定要不要回收空条目）。
   */
  linkFile(
    libraryId: number,
    fileId: number,
    grouping: FileGrouping,
    isNew: boolean,
    now: number,
    changes: ItemChanges
  ): boolean {
    let unlinked = false
    if (!isNew) {
      for (const id of this.topLevelOfFile(fileId)) changes.touch(id)
      unlinked =
        this.sql.get('DELETE FROM file_media WHERE file_id = ?').run(fileId)
          .changes > 0
    }
    for (const item of grouping.ancestors.concat(grouping.leaves)) {
      const { id, created } = this.ensure(libraryId, item, now)
      if (item.parentKey !== null) continue
      if (created) changes.added.add(id)
      else changes.touch(id)
    }
    const link = this.sql.get(
      'INSERT OR IGNORE INTO file_media (file_id, item_id) VALUES (?, ?)'
    )
    for (const leaf of grouping.leaves) {
      link.run(fileId, this.ids.get(leaf.localKey)!)
    }
    return unlinked
  }

  /** 把变化过的顶层条目的 updated_at 设为 now（新增的已经是 now）。 */
  bumpUpdated(changes: ItemChanges, now: number): void {
    const bump = this.sql.get(
      'UPDATE media_items SET updated_at = ? WHERE id = ?'
    )
    for (const id of changes.updated) bump.run(now, id)
  }

  /**
   * 回收媒体库里没有文件的条目（集 → 季 → 剧集 / 电影，逐层向上），
   * 被删的顶层条目记入 changes.removed。
   */
  collectGarbage(libraryId: number, changes: ItemChanges): void {
    const gc = this.sql.get(GC_SQL)
    for (const type of ['episode', 'season', 'series', 'movie'] as const) {
      for (const row of gc.all(libraryId, type)) {
        if (type === 'series' || type === 'movie') {
          const id = Number(row.id)
          changes.updated.delete(id)
          if (!changes.added.delete(id)) changes.removed.add(id)
        }
      }
    }
    this.ids.clear()
  }
}
