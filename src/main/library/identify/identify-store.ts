/**
 * 识别任务的数据库读写：挑出要识别的条目、读它们的文件 / 子条目 / NFO 位置，
 * 写匹配结果（matches 表与 media_items.match_state），以及把临时合并的电影按匹配结果拆开。
 *
 * 写方法都应在调用方的事务里执行。
 */
import type { MatchState } from '../../../shared/library/ipc'
import type { MediaRef } from '../../../shared/library/provider'
import type { ScoredCandidate } from '../../../shared/library/scoring'
import { type LibraryDb, StatementCache } from '../db/database'
import {
  type ChildItem,
  type IdentifyTarget,
  type MatchRow,
  type StoredCandidate,
  type TargetFile,
  type TargetMode,
  matchProviderId,
  storedCandidate,
  toChild,
  toMatch,
  toTarget,
  toTargetFile,
} from './identify-rows'

export {
  type ChildItem,
  type IdentifyTarget,
  OVERVIEW_SUMMARY_MAX,
  type StoredCandidate,
  type TargetFile,
  type TargetMode,
  storedCandidate,
} from './identify-rows'

const TARGET_COLUMNS = `id, library_id, type, local_key, title, year, match_state, tmdb_id,
  (SELECT source FROM libraries l WHERE l.id = media_items.library_id) AS source`

const MODE_WHERE: Record<TargetMode, string> = {
  pending: `match_state <> 'locked'
    AND (identified_at IS NULL OR updated_at > identified_at)`,
  force: `match_state <> 'locked'`,
  matched: `tmdb_id IS NOT NULL`,
  undecided: `match_state IN ('review', 'unmatched')`,
}

/** 识别仓库。 */
export class IdentifyStore {
  private readonly sql: StatementCache

  constructor(db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  /** 按 id 取顶层条目；不是顶层条目返回 undefined。 */
  target(itemId: number): IdentifyTarget | undefined {
    const row = this.sql
      .get(
        `SELECT ${TARGET_COLUMNS} FROM media_items
         WHERE id = ? AND type IN ('movie', 'series')`
      )
      .get(itemId)
    return row ? toTarget(row) : undefined
  }

  /**
   * 选出要处理的顶层条目。itemIds 给定时只在其中挑（季 / 集 id 会换成所属剧集）。
   */
  targets(
    mode: TargetMode,
    scope: { libraryId?: number; itemIds?: number[] }
  ): IdentifyTarget[] {
    const where = [MODE_WHERE[mode], "type IN ('movie', 'series')"]
    const params: Array<string | number> = []
    if (scope.libraryId !== undefined) {
      where.push('library_id = ?')
      params.push(scope.libraryId)
    }
    if (scope.itemIds) {
      where.push(`id IN (
        SELECT COALESCE(gp.id, p.id, i.id) FROM media_items i
        LEFT JOIN media_items p ON p.id = i.parent_id
        LEFT JOIN media_items gp ON gp.id = p.parent_id
        WHERE i.id IN (SELECT value FROM json_each(?)))`)
      params.push(JSON.stringify(scope.itemIds))
    }
    return this.sql
      .get(
        `SELECT ${TARGET_COLUMNS} FROM media_items WHERE ${where.join(' AND ')}
         ORDER BY id`
      )
      .all(...params)
      .map(toTarget)
  }

  /**
   * 这次识别 / 刷新是否涉及 TMDB 库（需要令牌）。番号库不需要令牌。
   * 范围：指定条目 → 这些条目所属的库；指定库 → 该库；都没指定 → 全部库。
   */
  needsTmdb(scope: { libraryId?: number; itemIds?: number[] }): boolean {
    if (scope.itemIds) {
      return Boolean(
        this.sql
          .get(
            `SELECT 1 FROM media_items i JOIN libraries l ON l.id = i.library_id
             WHERE i.id IN (SELECT value FROM json_each(?)) AND l.source = 'tmdb'
             LIMIT 1`
          )
          .get(JSON.stringify(scope.itemIds))
      )
    }
    const row =
      scope.libraryId === undefined
        ? this.sql
            .get("SELECT 1 FROM libraries WHERE source = 'tmdb' LIMIT 1")
            .get()
        : this.sql
            .get("SELECT 1 FROM libraries WHERE id = ? AND source = 'tmdb'")
            .get(scope.libraryId)
    return Boolean(row)
  }

  /** 条目（含子孙）关联的视频文件。 */
  files(itemId: number): Array<TargetFile & { itemId: number }> {
    return this.sql
      .get(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM media_items WHERE id = ?
           UNION ALL
           SELECT c.id FROM media_items c JOIN tree t ON c.parent_id = t.id
         )
         SELECT fm.item_id, f.id, f.display_path, f.dir, f.name, f.size,
                f.parsed, f.fingerprint, f.duration
         FROM tree JOIN file_media fm ON fm.item_id = tree.id
         JOIN files f ON f.id = fm.file_id
         WHERE f.kind = 'video'
         ORDER BY f.id`
      )
      .all(itemId)
      .map(toTargetFile)
  }

  /** 剧集下的全部季、集。 */
  children(seriesId: number): ChildItem[] {
    return this.sql
      .get(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM media_items WHERE parent_id = ?
           UNION ALL
           SELECT c.id FROM media_items c JOIN tree t ON c.parent_id = t.id
         )
         SELECT i.id, i.type, i.parent_id, i.season_number, i.episode_number,
                i.local_key
         FROM media_items i JOIN tree USING (id)
         ORDER BY i.season_number, i.episode_number, i.id`
      )
      .all(seriesId)
      .map(toChild)
  }

  /** 某目录下的 NFO 文件（名称 → 原始路径）。 */
  nfoFiles(dirKey: string): Map<string, string> {
    const out = new Map<string, string>()
    for (const r of this.sql
      .get(
        "SELECT name, display_path FROM files WHERE dir = ? AND kind = 'nfo'"
      )
      .all(dirKey)) {
      out.set(String(r.name).toLowerCase(), String(r.display_path))
    }
    return out
  }

  /** 某目录下的视频文件名（AI 识别兜底的线索），按名称排序，最多 limit 个。 */
  videoNamesIn(dirKey: string, limit = 20): string[] {
    return this.sql
      .get(
        `SELECT name FROM files WHERE dir = ? AND kind = 'video'
         ORDER BY name LIMIT ?`
      )
      .all(dirKey, limit)
      .map(r => String(r.name))
  }

  /** 媒体库根目录键。 */
  libraryRoot(
    libraryId: number
  ): { rootKey: string; root: string } | undefined {
    const row = this.sql
      .get('SELECT root, root_display FROM libraries WHERE id = ?')
      .get(libraryId)
    return row
      ? { rootKey: String(row.root), root: String(row.root_display) }
      : undefined
  }

  /** 记录探测到的时长。 */
  setDuration(fileId: number, seconds: number): void {
    this.sql
      .get('UPDATE files SET duration = ? WHERE id = ?')
      .run(seconds, fileId)
  }

  /** 补写指纹（识别时按需计算的）。 */
  setFingerprint(fileId: number, hash: string): void {
    this.sql
      .get(
        'UPDATE files SET fingerprint = ? WHERE id = ? AND fingerprint IS NULL'
      )
      .run(hash, fileId)
  }

  // —————————————————————————— 匹配写入 ——————————————————————————

  /** 删掉条目的非锁定匹配记录。 */
  private clearMatches(itemId: number): void {
    this.sql
      .get("DELETE FROM matches WHERE item_id = ? AND status <> 'locked'")
      .run(itemId)
  }

  /**
   * 写入确定的匹配：matches 只留这一条（status = auto / locked），
   * 条目的 match_state、外部 id 由元数据写入一并更新（见 MetadataWriter）。
   */
  writeMatch(
    itemId: number,
    ref: MediaRef,
    status: 'auto' | 'locked',
    confidence: number,
    candidate: StoredCandidate,
    now: number
  ): void {
    this.sql.get('DELETE FROM matches WHERE item_id = ?').run(itemId)
    this.sql
      .get(
        `INSERT INTO matches (item_id, provider, provider_id, confidence, status,
           candidate, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        itemId,
        ref.provider,
        matchProviderId(ref),
        confidence,
        status,
        JSON.stringify(candidate),
        now
      )
  }

  /**
   * 写入待确认 / 未匹配：保存前几名候选，条目状态改为 review / unmatched，
   * 清掉旧的 provider id 与元数据（之前的自动匹配已不成立）。
   */
  writeUndecided(
    itemId: number,
    state: 'review' | 'unmatched',
    candidates: ScoredCandidate[],
    now: number
  ): void {
    this.clearMatches(itemId)
    const insert = this.sql.get(
      `INSERT OR IGNORE INTO matches (item_id, provider, provider_id, confidence,
         status, candidate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const s of candidates) {
      insert.run(
        itemId,
        s.candidate.ref.provider,
        matchProviderId(s.candidate.ref),
        s.score,
        state,
        JSON.stringify(storedCandidate(s.candidate, s.breakdown)),
        now
      )
    }
    this.sql
      .get(
        `UPDATE media_items SET match_state = ?, identified_at = ?,
           tmdb_id = NULL, imdb_id = NULL, tvdb_id = NULL
         WHERE id = ? AND match_state <> 'locked'`
      )
      .run(state, now, itemId)
  }

  /** 条目的匹配记录（当前匹配在前，其余按置信度降序）。 */
  matches(itemId: number): MatchRow[] {
    return this.sql
      .get(
        `SELECT provider, provider_id, confidence, status, candidate FROM matches
         WHERE item_id = ?
         ORDER BY status IN ('auto', 'locked') DESC, confidence DESC, id`
      )
      .all(itemId)
      .map(toMatch)
  }

  /** 设置匹配状态（锁定 / 解锁）。 */
  setMatchState(itemId: number, state: MatchState, now: number): void {
    this.sql
      .get(
        'UPDATE media_items SET match_state = ?, updated_at = ?, identified_at = ? WHERE id = ?'
      )
      .run(state, now, now, itemId)
    this.sql
      .get(
        `UPDATE matches SET status = ? WHERE item_id = ? AND status IN ('auto', 'locked')`
      )
      .run(state === 'locked' ? 'locked' : 'auto', itemId)
  }

  /**
   * 把电影条目的一部分文件拆到新条目（同名无年份被临时合并、实际是不同影片时）。
   * 新条目 local_key = 原 key + '#tmdb:<id>'，已存在则复用。返回新条目 id。
   */
  splitMovie(
    item: IdentifyTarget,
    fileIds: number[],
    ref: MediaRef,
    now: number
  ): number {
    const localKey = `${item.localKey}#${ref.provider}:${ref.id}`
    const existing = this.sql
      .get('SELECT id FROM media_items WHERE local_key = ?')
      .get(localKey)
    const id = existing
      ? Number(existing.id)
      : Number(
          this.sql
            .get(
              `INSERT INTO media_items (library_id, type, parent_id, local_key, title,
                 original_title, sort_title, search_text, year, added_at, updated_at)
               SELECT library_id, type, NULL, ?, title, original_title, sort_title,
                 search_text, year, ?, ?
               FROM media_items WHERE id = ? RETURNING id`
            )
            .get(localKey, now, now, item.id)!.id
        )
    const move = this.sql.get(
      'UPDATE file_media SET item_id = ? WHERE file_id = ? AND item_id = ?'
    )
    for (const fileId of fileIds) move.run(id, fileId, item.id)
    return id
  }
}
