/**
 * 新入库的读取：水位之后入库、有视频文件的电影 / 集，连同顶层条目（电影本身 / 剧）的片名与识别状态；
 * 游标存在片库设置表（键 arrivals.cursor）。
 */
import type { LibraryArrival } from '../../../shared/library/arrivals'
import { type LibraryDb, StatementCache } from '../db/database'
import { SettingsStore } from '../providers/settings-store'
import {
  type ArrivalCursor,
  type ArrivalRow,
  parseCursor,
} from './arrival-rules'

/** 游标的设置键。 */
const CURSOR_KEY = 'arrivals.cursor'
/** 一轮最多看多少条（一次扫进几千集时分几轮宣布）。 */
export const ARRIVAL_BATCH = 500

/** 候选 + 宣布时要用的字段。 */
export type ArrivalCandidate = ArrivalRow & LibraryArrival

/** 集挂在季下或直接挂在剧下；顶层条目取电影本身 / 剧。 */
const CANDIDATES_SQL = `SELECT i.id, i.library_id, i.type, i.title AS leaf_title,
    i.season_number, i.episode_number, i.added_at,
    t.id AS top_id, t.title, t.year, t.match_state, t.identified_at,
    (SELECT f.display_path FROM file_media fm JOIN files f ON f.id = fm.file_id
      WHERE fm.item_id = i.id AND f.kind = 'video' ORDER BY f.path LIMIT 1) AS file_path
  FROM media_items i
  LEFT JOIN media_items p ON p.id = i.parent_id
  JOIN media_items t ON t.id = CASE
    WHEN i.type = 'movie' THEN i.id
    WHEN p.type = 'series' THEN p.id
    ELSE p.parent_id END
  WHERE i.type IN ('movie', 'episode') AND i.added_at > ?
  ORDER BY i.added_at, i.id LIMIT ${ARRIVAL_BATCH}`

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null
const int = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value)

/** 新入库的读写。 */
export class ArrivalStore {
  private readonly sql: StatementCache
  private readonly settings: SettingsStore

  constructor(db: LibraryDb) {
    this.sql = new StatementCache(db)
    this.settings = new SettingsStore(db)
  }

  /** 读游标；没有时从 now 开始（并立即存下，之后入库的才算新）。 */
  cursor(now: number): ArrivalCursor {
    const raw = this.settings.get(CURSOR_KEY)
    const cursor = parseCursor(raw, now)
    if (raw === undefined) this.saveCursor(cursor, now)
    return cursor
  }

  saveCursor(cursor: ArrivalCursor, now: number): void {
    this.settings.set(CURSOR_KEY, JSON.stringify(cursor), now)
  }

  /** 水位之后入库、有视频文件的电影 / 集。 */
  candidates(since: number): ArrivalCandidate[] {
    const out: ArrivalCandidate[] = []
    for (const row of this.sql.get(CANDIDATES_SQL).all(since)) {
      const filePath = text(row.file_path)
      if (!filePath) continue
      const episode = row.type === 'episode'
      const matched = row.match_state === 'auto' || row.match_state === 'locked'
      out.push({
        itemId: Number(row.id),
        libraryId: Number(row.library_id),
        kind: episode ? 'episode' : 'movie',
        topId: Number(row.top_id),
        title: text(row.title) ?? text(row.leaf_title) ?? '',
        year: int(row.year),
        season: episode ? int(row.season_number) : null,
        episode: episode ? int(row.episode_number) : null,
        // 集名只在剧已匹配时可信（没识别时是文件名解析出来的占位）
        episodeTitle: episode && matched ? text(row.leaf_title) : null,
        matched,
        filePath,
        addedAt: Number(row.added_at),
        identifiedAt: int(row.identified_at),
      })
    }
    return out
  }
}
