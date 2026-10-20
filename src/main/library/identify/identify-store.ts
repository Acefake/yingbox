/**
 * 识别任务的数据库读写：挑出要识别的条目、读它们的文件 / 子条目 / NFO 位置，
 * 写匹配结果（matches 表与 media_items.match_state），以及把临时合并的电影按匹配结果拆开。
 *
 * 写方法都应在调用方的事务里执行。
 */
import type { MatchState, MediaItemType } from '../../../shared/library/ipc'
import type { ParsedMedia } from '../../../shared/library/parser'
import type { Candidate, MediaRef } from '../../../shared/library/provider'
import type { ScoredCandidate } from '../../../shared/library/scoring'
import { type LibraryDb, StatementCache } from '../db/database'

/** 一个待识别的顶层条目。 */
export interface IdentifyTarget {
  id: number
  libraryId: number
  type: Extract<MediaItemType, 'movie' | 'series'>
  localKey: string
  title: string
  year: number | null
  matchState: MatchState
  tmdbId: string | null
}

/** 条目关联的一个视频文件。 */
export interface TargetFile {
  id: number
  displayPath: string
  dir: string
  name: string
  size: number
  parsed: ParsedMedia | null
  fingerprint: string | null
  /** 秒；未探测为 null。 */
  duration: number | null
}

/** 剧集下的季 / 集条目。 */
export interface ChildItem {
  id: number
  type: 'season' | 'episode'
  parentId: number
  season: number | null
  episode: number | null
  localKey: string
}

/** 存进 matches.candidate 的候选摘要。 */
export interface StoredCandidate {
  title: string
  originalTitle?: string
  year?: number
  posterPath?: string
  /** 简介摘要（截断到 OVERVIEW_SUMMARY_MAX 字）。 */
  overview?: string
  breakdown?: Record<string, number>
}

/** 候选简介摘要的最大字数：只给待确认列表看个大概，不占数据库空间。 */
export const OVERVIEW_SUMMARY_MAX = 160

/** 选目标的方式。 */
export type TargetMode =
  /** 只要“没识别过或文件变过”的、非锁定条目。 */
  | 'pending'
  /** 全部非锁定条目。 */
  | 'force'
  /** 已有 tmdb_id 的条目（含锁定），刷新元数据用。 */
  | 'matched'

const TARGET_COLUMNS = `id, library_id, type, local_key, title, year, match_state, tmdb_id`

const MODE_WHERE: Record<TargetMode, string> = {
  pending: `match_state <> 'locked'
    AND (identified_at IS NULL OR updated_at > identified_at)`,
  force: `match_state <> 'locked'`,
  matched: `tmdb_id IS NOT NULL`,
}

function toTarget(row: Record<string, unknown>): IdentifyTarget {
  return {
    id: Number(row.id),
    libraryId: Number(row.library_id),
    type: row.type as IdentifyTarget['type'],
    localKey: String(row.local_key),
    title: String(row.title),
    year: row.year === null ? null : Number(row.year),
    matchState: row.match_state as MatchState,
    tmdbId: row.tmdb_id === null ? null : String(row.tmdb_id),
  }
}

function parseJson<T>(text: unknown): T | null {
  if (text === null || text === undefined) return null
  try {
    return JSON.parse(String(text)) as T
  } catch {
    return null
  }
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
      .map(r => ({
        itemId: Number(r.item_id),
        id: Number(r.id),
        displayPath: String(r.display_path),
        dir: String(r.dir),
        name: String(r.name),
        size: Number(r.size),
        parsed: parseJson<ParsedMedia>(r.parsed),
        fingerprint: r.fingerprint === null ? null : String(r.fingerprint),
        duration: r.duration === null ? null : Number(r.duration),
      }))
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
      .map(r => ({
        id: Number(r.id),
        type: r.type as ChildItem['type'],
        parentId: Number(r.parent_id),
        season: r.season_number === null ? null : Number(r.season_number),
        episode: r.episode_number === null ? null : Number(r.episode_number),
        localKey: String(r.local_key),
      }))
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
        `${ref.kind}:${ref.id}`,
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
        `${s.candidate.ref.kind}:${s.candidate.ref.id}`,
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
  matches(itemId: number): Array<{
    ref: MediaRef
    status: MatchState
    confidence: number
    candidate: StoredCandidate
  }> {
    return this.sql
      .get(
        `SELECT provider, provider_id, confidence, status, candidate FROM matches
         WHERE item_id = ?
         ORDER BY status IN ('auto', 'locked') DESC, confidence DESC, id`
      )
      .all(itemId)
      .map(r => {
        const [kind, id] = String(r.provider_id).split(':')
        return {
          ref: {
            provider: 'tmdb',
            kind: kind as MediaRef['kind'],
            id,
          },
          status: r.status as MatchState,
          confidence: Number(r.confidence),
          candidate: parseJson<StoredCandidate>(r.candidate) ?? { title: '' },
        }
      })
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

/** 候选 → matches.candidate。 */
export function storedCandidate(
  c: Candidate,
  breakdown?: object
): StoredCandidate {
  const clean: Record<string, number> = {}
  for (const [k, v] of Object.entries(breakdown ?? {}) as Array<
    [string, unknown]
  >) {
    if (typeof v === 'number') clean[k] = Math.round(v * 1000) / 1000
  }
  return {
    title: c.title,
    ...(c.originalTitle ? { originalTitle: c.originalTitle } : {}),
    ...(c.year ? { year: c.year } : {}),
    ...(c.posterPath ? { posterPath: c.posterPath } : {}),
    ...(c.overview
      ? { overview: c.overview.slice(0, OVERVIEW_SUMMARY_MAX) }
      : {}),
    ...(Object.keys(clean).length ? { breakdown: clean } : {}),
  }
}
