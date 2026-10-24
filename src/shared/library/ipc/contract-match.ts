/**
 * 媒体库 IPC 契约 · 手动匹配：匹配候选、当前匹配与手动指定 / 重新搜索。
 *
 * 只有类型，由 contract.ts 统一再导出。
 */
import type { MediaKind } from '../provider'
import type { LibraryItemSummary, MatchState } from './contract'

/** 一个匹配候选（待确认列表、手动搜索结果）。 */
export interface MatchCandidateInfo {
  provider: 'tmdb'
  kind: MediaKind
  id: string
  title: string
  originalTitle: string | null
  year: number | null
  /** 0–1。 */
  confidence: number
  /** 各信号得分（title / year / runtime / episodes）。 */
  breakdown: Record<string, number>
  /** TMDB 海报远程地址（w185），候选还没缓存，直接用远程图。 */
  poster: string | null
  /** 简介摘要（最多 160 字）；搜索结果没有简介为 null。 */
  overview: string | null
  /** 'ai'：候选由 AI 识别兜底推断后经 TMDB 验证得到；常规识别没有这一项。 */
  source?: 'ai'
}

/** 某条目当前的匹配与候选。 */
export interface MatchCandidatesResult {
  itemId: number
  matchState: MatchState
  /** 当前匹配（auto / locked）；没有为 null。 */
  current: MatchCandidateInfo | null
  /** 待确认 / 未匹配时保存的前几名候选。 */
  candidates: MatchCandidateInfo[]
}

/**
 * 手动匹配：三选一——
 * - tmdbId：直接指定（kind 缺省取条目类型）；
 * - imdbId / tvdbId：反查后指定；
 * - query：用给定标题（和年份）重新搜索打分，够自信自动应用，否则返回候选。
 */
export interface ApplyMatchRequest {
  itemId: number
  tmdbId?: string
  imdbId?: string
  tvdbId?: string
  query?: { title: string; year?: number }
  /** 指定 id 时是否锁定，默认 true（手动选择的结果之后不被自动识别覆盖）。 */
  lock?: boolean
}

/** 手动匹配结果。 */
export interface ApplyMatchResult {
  status: 'matched' | 'review' | 'unmatched'
  item: LibraryItemSummary | null
  candidates: MatchCandidateInfo[]
}
