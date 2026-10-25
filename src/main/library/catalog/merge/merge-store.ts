/**
 * 合并展示的数据库读写：同键成员、手动拆分 / 恢复、版本分组要的文件信息。
 *
 * 成员只在同一来源（TMDB 片库 / 番号库）的媒体库之间找：两种库的 tmdb_id 列含义不同。
 */
import { LibraryError } from '../../../../shared/library/ipc'
import { type LibraryDb, StatementCache } from '../../db/database'
import type { VersionFileMeta } from './version-rules'

/** 与 id 同键、同来源的全部顶层条目（含自身），id 升序；没合并时只有自己。 */
const MEMBERS_SQL = `
SELECT m.id FROM media_items i
JOIN libraries li ON li.id = i.library_id
JOIN media_items m ON m.merge_key = i.merge_key
JOIN libraries lm ON lm.id = m.library_id AND lm.source = li.source
WHERE i.id = ?
ORDER BY m.id`

/** 被拆出的条目：同一作品（同类型、同 id、已确认匹配、同来源）的其它顶层条目数。 */
const SPLIT_PEERS_SQL = `
SELECT COUNT(*) AS n FROM media_items i
JOIN libraries li ON li.id = i.library_id
JOIN media_items m ON m.type = i.type AND m.tmdb_id = i.tmdb_id AND m.id <> i.id
  AND m.parent_id IS NULL AND m.match_state IN ('auto', 'locked')
JOIN libraries lm ON lm.id = m.library_id AND lm.source = li.source
WHERE i.id = ?`

/** 合并仓库。 */
export class MergeStore {
  private readonly sql: StatementCache

  constructor(db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  /** 与条目合并展示的全部本地条目 id（含自身，升序）；条目不存在返回空数组。 */
  membersOf(itemId: number): number[] {
    const ids = this.sql
      .get(MEMBERS_SQL)
      .all(itemId)
      .map(r => Number(r.id))
    if (ids.length) return ids
    const exists = this.sql
      .get('SELECT 1 FROM media_items WHERE id = ?')
      .get(itemId)
    return exists ? [itemId] : []
  }

  /** 条目被手动拆出时，同一作品还有几个别的本地条目；没拆过（或拆分已因改匹配失效）为 0。 */
  splitPeers(itemId: number): number {
    const row = this.sql
      .get(
        `SELECT 1 FROM media_items WHERE id = ? AND merge_split IS NOT NULL
           AND merge_split = tmdb_id`
      )
      .get(itemId)
    if (!row) return 0
    return Number(this.sql.get(SPLIT_PEERS_SQL).get(itemId)!.n)
  }

  /**
   * 拆出：记下当前匹配的 id，之后不再参与合并。返回拆分前同组的成员（推送变化用）。
   * 不动 updated_at：它晚于 identified_at 表示文件有变化、要重新识别。
   * 只接受已确认匹配的顶层条目，否则抛 invalid-params。
   */
  split(itemId: number): number[] {
    const members = this.membersOf(itemId)
    const changed = this.sql
      .get(
        `UPDATE media_items SET merge_split = tmdb_id
         WHERE id = ? AND parent_id IS NULL AND tmdb_id IS NOT NULL`
      )
      .run(itemId).changes
    if (!changed) {
      throw new LibraryError('invalid-params', '只有已匹配的顶层条目可以拆分')
    }
    return members
  }

  /** 恢复合并：清掉拆分记录。返回恢复后同组的成员（推送变化用）。 */
  join(itemId: number): number[] {
    const changed = this.sql
      .get(
        `UPDATE media_items SET merge_split = NULL
         WHERE id = ? AND parent_id IS NULL`
      )
      .run(itemId).changes
    if (!changed) {
      throw new LibraryError('invalid-params', '条目不存在或不是顶层条目')
    }
    return this.membersOf(itemId)
  }

  /**
   * 版本分组要的文件信息：分段号与文件所属的顶层条目。
   * @param fileOwners 文件 id → 所属顶层条目 id（合并时已知）
   */
  fileMeta(
    fileOwners: ReadonlyMap<number, number>
  ): Map<number, VersionFileMeta> {
    const out = new Map<number, VersionFileMeta>()
    if (!fileOwners.size) return out
    const rows = this.sql
      .get(
        `SELECT id, library_id, json_extract(parsed, '$.part') AS part FROM files
         WHERE id IN (SELECT value FROM json_each(?))`
      )
      .all(JSON.stringify([...fileOwners.keys()]))
    for (const row of rows) {
      const id = Number(row.id)
      const part = row.part === null ? null : Number(row.part)
      out.set(id, {
        part: Number.isInteger(part) ? part : null,
        itemId: fileOwners.get(id)!,
        libraryId: Number(row.library_id),
      })
    }
    return out
  }

  /** 这些条目所在的媒体库（推送事件按库拆分用）。 */
  librariesOf(itemIds: readonly number[]): Map<number, number> {
    const out = new Map<number, number>()
    for (const row of this.sql
      .get(
        'SELECT id, library_id FROM media_items WHERE id IN (SELECT value FROM json_each(?))'
      )
      .all(JSON.stringify(itemIds))) {
      out.set(Number(row.id), Number(row.library_id))
    }
    return out
  }
}
