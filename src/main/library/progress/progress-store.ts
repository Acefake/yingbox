/**
 * 观看进度表（watch_progress）的读写：上报合并、按条目树查、海报墙概况、最近观看、跨库导出 / 导入。
 *
 * 合并规则在 shared/library/watch-progress.ts；这里只管 SQL。桌面端引擎与独立片库服务共用。
 */
import type {
  ProgressImportResult,
  ProgressReport,
  ProgressSummary,
  ProgressSyncEntry,
  RecentProgress,
  WatchProgress,
} from '../../../shared/library/ipc'
import {
  applyReport,
  incomingWins,
  progressSyncKey,
} from '../../../shared/library/watch-progress'
import type { LibraryDb } from '../db/database'

type Row = Record<string, unknown>

const COLUMNS = 'item_id, file_id, position, duration, watched, updated_at'

function toProgress(row: Row): WatchProgress {
  return {
    itemId: Number(row.item_id),
    fileId: row.file_id === null ? null : Number(row.file_id),
    position: Number(row.position),
    duration: Number(row.duration),
    watched: Number(row.watched) === 1,
    updatedAt: Number(row.updated_at),
  }
}

/** 条目及其全部下属的 id（剧 → 季 → 集）。 */
const SUBTREE = `
WITH RECURSIVE tree(id) AS (
  SELECT value FROM json_each(?)
  UNION
  SELECT m.id FROM media_items m JOIN tree ON m.parent_id = tree.id
)`

/** 条目往上的顶层祖先（顶层条目自己就是）。 */
const ROOT_OF = `
WITH RECURSIVE up(id, parent_id, root) AS (
  SELECT id, parent_id, id FROM media_items WHERE id IN (SELECT item_id FROM watch_progress)
  UNION ALL
  SELECT up.id, m.parent_id, m.id FROM up JOIN media_items m ON m.id = up.parent_id
)
SELECT id, root FROM up WHERE parent_id IS NULL`

/** 观看进度存储。 */
export class ProgressStore {
  constructor(private readonly db: LibraryDb) {}

  /** 一条进度；没有为 null。 */
  get(itemId: number): WatchProgress | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM watch_progress WHERE item_id = ?`)
      .get(itemId)
    return row ? toProgress(row) : null
  }

  /** 这些条目及其下属的进度。 */
  list(itemIds: readonly number[]): WatchProgress[] {
    if (!itemIds.length) return []
    return this.db
      .prepare(
        `${SUBTREE} SELECT ${COLUMNS} FROM watch_progress
         WHERE item_id IN (SELECT id FROM tree)`
      )
      .all(JSON.stringify(itemIds))
      .map(toProgress)
  }

  /** 写入上报，返回写入后的进度。只认电影和集，别的条目（剧、季、不存在的）跳过。 */
  save(reports: readonly ProgressReport[], now = Date.now()): WatchProgress[] {
    const playable = this.db.prepare(
      "SELECT 1 FROM media_items WHERE id = ? AND type IN ('movie', 'episode')"
    )
    const out: WatchProgress[] = []
    this.transaction(() => {
      for (const report of reports) {
        if (!playable.get(report.itemId)) continue
        const next = applyReport(this.get(report.itemId), report, now)
        if (next.fileId !== null && !this.fileExists(next.fileId))
          next.fileId = null
        this.put(next)
        out.push(next)
      }
    })
    return out
  }

  /** 海报墙：顶层条目的观看概况（电影按位置，剧按看完的集数）；没看过的不返回。 */
  summary(itemIds: readonly number[]): ProgressSummary[] {
    if (!itemIds.length) return []
    const rows = this.db
      .prepare(
        `WITH RECURSIVE tree(root, id, type) AS (
           SELECT m.id, m.id, m.type FROM media_items m
           WHERE m.id IN (SELECT value FROM json_each(?))
           UNION ALL
           SELECT tree.root, m.id, m.type FROM media_items m JOIN tree ON m.parent_id = tree.id
         )
         SELECT tree.root AS root,
                MAX(tree.type = 'movie') AS is_movie,
                COUNT(DISTINCT CASE WHEN tree.type IN ('movie', 'episode')
                  AND EXISTS (SELECT 1 FROM file_media fm WHERE fm.item_id = tree.id)
                  THEN tree.id END) AS playable,
                SUM(p.watched) AS watched,
                MAX(CASE WHEN p.duration > 0 THEN p.position / p.duration END) AS ratio,
                MAX(p.updated_at) AS updated_at
         FROM tree LEFT JOIN watch_progress p ON p.item_id = tree.id
         GROUP BY tree.root
         HAVING MAX(p.updated_at) IS NOT NULL`
      )
      .all(JSON.stringify(itemIds))
    return rows.map(row => {
      const playable = Number(row.playable)
      const watched = Number(row.watched ?? 0)
      const movie = Number(row.is_movie) === 1
      const done = movie ? watched > 0 : playable > 0 && watched >= playable
      const ratio = movie
        ? Number(row.ratio ?? 0)
        : playable > 0
          ? watched / playable
          : 0
      return {
        itemId: Number(row.root),
        watched: done,
        ratio: done ? 1 : Math.min(1, Math.max(0, ratio)),
        updatedAt: Number(row.updated_at),
      }
    })
  }

  /** 最近观看的顶层条目：每个顶层条目取最近的一条进度，最近的在前。 */
  recent(limit = 40): RecentProgress[] {
    const roots = new Map<number, number>()
    for (const row of this.db.prepare(ROOT_OF).all())
      roots.set(Number(row.id), Number(row.root))
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS.split(', ')
          .map(c => `p.${c}`)
          .join(', ')}, m.library_id
         FROM watch_progress p JOIN media_items m ON m.id = p.item_id
         ORDER BY p.updated_at DESC, p.item_id DESC`
      )
      .all()
    const seen = new Set<number>()
    const out: RecentProgress[] = []
    for (const row of rows) {
      const progress = toProgress(row)
      const rootId = roots.get(progress.itemId) ?? progress.itemId
      if (seen.has(rootId)) continue
      seen.add(rootId)
      out.push({ ...progress, rootId, libraryId: Number(row.library_id) })
      if (out.length >= limit) break
    }
    return out
  }

  /** 导出能对上跨库键的进度（updatedAt ≥ since）。 */
  export(since = 0): ProgressSyncEntry[] {
    const out: ProgressSyncEntry[] = []
    for (const row of this.keyedRows('p.updated_at >= ?', since)) {
      const key = progressSyncKey(row.source)
      if (!key) continue
      const { position, duration, watched, updatedAt } = row.progress
      out.push({ key, position, duration, watched, updatedAt })
    }
    return out
  }

  /** 导入：按跨库键对上本地条目，比本地新的才写。 */
  import(
    entries: readonly ProgressSyncEntry[],
    preferIncoming = false
  ): ProgressImportResult {
    const index = this.keyIndex()
    const itemIds: number[] = []
    let unmatched = 0
    this.transaction(() => {
      for (const entry of entries) {
        const target = index.get(entry.key)
        if (!target) {
          unmatched++
          continue
        }
        const current = this.get(target.itemId)
        if (!incomingWins(current, entry, preferIncoming)) continue
        this.put({
          itemId: target.itemId,
          fileId: current?.fileId ?? target.fileId,
          position: entry.position,
          duration: entry.duration,
          watched: entry.watched,
          updatedAt: entry.updatedAt,
        })
        itemIds.push(target.itemId)
      }
    })
    return { applied: itemIds.length, unmatched, itemIds }
  }

  // —————————————————————————— 内部 ——————————————————————————

  private put(p: WatchProgress): void {
    this.db
      .prepare(
        `INSERT INTO watch_progress (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (item_id) DO UPDATE SET file_id = excluded.file_id,
           position = excluded.position, duration = excluded.duration,
           watched = excluded.watched, updated_at = excluded.updated_at`
      )
      .run(
        p.itemId,
        p.fileId,
        p.position,
        p.duration,
        p.watched ? 1 : 0,
        p.updatedAt
      )
  }

  private fileExists(fileId: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM files WHERE id = ?').get(fileId)
  }

  /**
   * 可同步条目（电影与集）及其同步键要的信息。where 作用在 watch_progress p 上；
   * 不给 where 时列出全部电影与集（导入时建键索引）。
   */
  private keyedRows(
    where?: string,
    ...args: number[]
  ): Array<{
    itemId: number
    fileId: number | null
    source: Parameters<typeof progressSyncKey>[0]
    progress: WatchProgress
  }> {
    const join = where ? 'JOIN' : 'LEFT JOIN'
    const rows = this.db
      .prepare(
        `SELECT m.id AS item_id, m.type, m.season_number, m.episode_number,
                CASE WHEN m.type = 'movie' THEN m.tmdb_id
                     ELSE COALESCE(s.tmdb_id, ss.tmdb_id) END AS tmdb,
                (SELECT f.id FROM file_media fm JOIN files f ON f.id = fm.file_id
                 WHERE fm.item_id = m.id AND f.kind = 'video' ORDER BY f.path LIMIT 1) AS first_file,
                (SELECT f.fingerprint FROM file_media fm JOIN files f ON f.id = fm.file_id
                 WHERE fm.item_id = m.id AND f.kind = 'video' AND f.fingerprint IS NOT NULL
                 ORDER BY f.path LIMIT 1) AS fingerprint,
                p.file_id, p.position, p.duration, p.watched, p.updated_at
         FROM media_items m
         ${join} watch_progress p ON p.item_id = m.id
         LEFT JOIN media_items s ON s.id = m.parent_id
         LEFT JOIN media_items ss ON ss.id = s.parent_id
         WHERE m.type IN ('movie', 'episode') ${where ? `AND ${where}` : ''}`
      )
      .all(...args)
    return rows.map(row => ({
      itemId: Number(row.item_id),
      fileId: row.first_file === null ? null : Number(row.first_file),
      source: {
        type: row.type === 'movie' ? 'movie' : 'episode',
        tmdbId: row.tmdb === null ? null : String(row.tmdb),
        season: row.season_number === null ? null : Number(row.season_number),
        episode:
          row.episode_number === null ? null : Number(row.episode_number),
        fingerprint: row.fingerprint === null ? null : String(row.fingerprint),
      },
      progress: toProgress({ ...row, updated_at: row.updated_at ?? 0 }),
    }))
  }

  /** 跨库键 → 本地条目；同一个键对上多个条目时取第一个（同一集的多版本）。 */
  private keyIndex(): Map<string, { itemId: number; fileId: number | null }> {
    const index = new Map<string, { itemId: number; fileId: number | null }>()
    for (const row of this.keyedRows()) {
      const key = progressSyncKey(row.source)
      if (key && !index.has(key))
        index.set(key, { itemId: row.itemId, fileId: row.fileId })
    }
    return index
  }

  private transaction(run: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      run()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
