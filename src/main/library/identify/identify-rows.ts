/**
 * 识别仓库的行类型与纯转换：数据库行 → 目标 / 文件 / 子条目 / 匹配记录，候选摘要的清洗。
 * 不碰数据库，供 identify-store 使用并单测。
 */
import type {
  LibrarySource,
  MatchState,
  MediaItemType,
} from '../../../shared/library/ipc'
import type { ParsedMedia } from '../../../shared/library/parser'
import type {
  Candidate,
  MediaRef,
  ProviderName,
} from '../../../shared/library/provider'

/** 一个待识别的顶层条目。 */
export interface IdentifyTarget {
  id: number
  libraryId: number
  type: Extract<MediaItemType, 'movie' | 'series'>
  localKey: string
  title: string
  year: number | null
  matchState: MatchState
  /** 已匹配的元数据源 id：TMDB 数字 id，番号库为番号。 */
  tmdbId: string | null
  /** 所属媒体库的元数据来源。 */
  source: LibrarySource
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

/** 数据库行。 */
type Row = Record<string, unknown>

/** 可空列 → number | null。 */
const numOrNull = (v: unknown): number | null => (v === null ? null : Number(v))

/** media_items 行 → 识别目标。 */
export function toTarget(row: Row): IdentifyTarget {
  return {
    id: Number(row.id),
    libraryId: Number(row.library_id),
    type: row.type as IdentifyTarget['type'],
    localKey: String(row.local_key),
    title: String(row.title),
    year: numOrNull(row.year),
    matchState: row.match_state as MatchState,
    tmdbId: row.tmdb_id === null ? null : String(row.tmdb_id),
    source: row.source === 'jav' ? 'jav' : 'tmdb',
  }
}

/** files ⋈ file_media 行 → 条目文件（parsed 列是 JSON，坏数据当作未解析）。 */
export function toTargetFile(r: Row): TargetFile & { itemId: number } {
  return {
    itemId: Number(r.item_id),
    id: Number(r.id),
    displayPath: String(r.display_path),
    dir: String(r.dir),
    name: String(r.name),
    size: Number(r.size),
    parsed: parseJson<ParsedMedia>(r.parsed),
    fingerprint: r.fingerprint === null ? null : String(r.fingerprint),
    duration: numOrNull(r.duration),
  }
}

/** media_items 行 → 季 / 集条目。 */
export function toChild(r: Row): ChildItem {
  return {
    id: Number(r.id),
    type: r.type as ChildItem['type'],
    parentId: Number(r.parent_id),
    season: numOrNull(r.season_number),
    episode: numOrNull(r.episode_number),
    localKey: String(r.local_key),
  }
}

/** 一条匹配记录。 */
export interface MatchRow {
  ref: MediaRef
  status: MatchState
  confidence: number
  candidate: StoredCandidate
}

/** matches.provider_id 的写法：`<kind>:<id>`。 */
export const matchProviderId = (ref: Pick<MediaRef, 'kind' | 'id'>): string =>
  `${ref.kind}:${ref.id}`

/** matches 行 → 匹配记录（候选摘要坏了当作空标题）。 */
export function toMatch(r: Row): MatchRow {
  const raw = String(r.provider_id)
  const colon = raw.indexOf(':')
  const [kind, id] = [raw.slice(0, colon), raw.slice(colon + 1)]
  return {
    ref: {
      provider: r.provider === 'jav' ? 'jav' : ('tmdb' as ProviderName),
      kind: kind as MediaRef['kind'],
      id,
    },
    status: r.status as MatchState,
    confidence: Number(r.confidence),
    candidate: parseJson<StoredCandidate>(r.candidate) ?? { title: '' },
  }
}

/** 解析 JSON 列；空值或坏数据返回 null。 */
export function parseJson<T>(text: unknown): T | null {
  if (text === null || text === undefined) return null
  try {
    return JSON.parse(String(text)) as T
  } catch {
    return null
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
