/**
 * 识别模块的纯规则：排队载荷合并、任务键、目标范围、刷新时要过期的缓存键、
 * 进度事件、变化按媒体库分组 / 去重，以及候选与错误的 IPC 转换。
 *
 * 不碰数据库与网络，供 identify-module / identify-job 共用并单测。
 */
import {
  type IdentifyProgressEvent,
  LibraryError,
  type LibraryEvent,
  type MatchCandidateInfo,
} from '../../../shared/library/ipc'
import type { ScoredCandidate } from '../../../shared/library/scoring'
import { ItemChanges } from '../catalog/catalog-store'
import { ProviderAuthError } from '../providers/http/provider-http'
import { TmdbProvider } from '../providers/tmdb/tmdb-provider'
import {
  type IdentifyTarget,
  OVERVIEW_SUMMARY_MAX,
  type StoredCandidate,
} from './identify-store'
import type { RunMode, RunSummary } from './runner-types'

/** identify 任务载荷。 */
export interface IdentifyPayload {
  mode: RunMode
  libraryId?: number
  itemIds?: number[]
}

/** 合并同 key 的排队识别：任一方是整库就是整库，否则条目取并集。 */
export function mergeIdentifyPayload(a: unknown, b: unknown): IdentifyPayload {
  const x = a as IdentifyPayload
  const y = b as IdentifyPayload
  if (!x.itemIds || !y.itemIds) {
    return { mode: x.mode, libraryId: x.libraryId ?? y.libraryId }
  }
  return {
    mode: x.mode,
    libraryId: x.libraryId,
    itemIds: [...new Set([...x.itemIds, ...y.itemIds])],
  }
}

/** 排队键：同模式、同范围（指定条目 / 某个库）的识别合并成一个任务。 */
export function identifyJobKey(payload: IdentifyPayload): string {
  const scope = payload.itemIds ? 'items' : `library:${payload.libraryId}`
  return `identify:${payload.mode}:${scope}`
}

/** 执行模式对应的目标范围：刷新取已匹配的，强制取全部，识别取待识别的。 */
export function targetScope(mode: RunMode): 'matched' | 'force' | 'pending' {
  return mode === 'refresh' ? 'matched' : mode === 'force' ? 'force' : 'pending'
}

/** 刷新元数据时要过期的 TMDB 响应缓存键前缀（走 ETag 条件请求拿最新数据）。 */
export function refreshCacheKeys(
  targets: Pick<IdentifyTarget, 'type' | 'tmdbId'>[]
): string[] {
  return targets.flatMap(t =>
    t.type === 'movie'
      ? [`tmdb:/movie/${t.tmdbId}?`]
      : [`tmdb:/tv/${t.tmdbId}?`, `tmdb:/tv/${t.tmdbId}/`]
  )
}

/** 由批量统计构造 identify-progress 事件。 */
export function progressEvent(
  jobId: number,
  payload: IdentifyPayload,
  summary: RunSummary,
  finished: boolean,
  error?: string
): IdentifyProgressEvent {
  return {
    type: 'identify-progress',
    jobId,
    mode: payload.mode === 'refresh' ? 'refresh' : 'identify',
    libraryId: payload.libraryId ?? null,
    total: summary.total,
    done: summary.done,
    matched: summary.matched,
    review: summary.review,
    unmatched: summary.unmatched,
    failed: summary.failed,
    finished,
    ...(error ? { error } : {}),
  }
}

/**
 * 把变化按媒体库拆成 items-changed 事件；查不到所属库的条目丢弃。
 * 事件顺序按各库第一次出现的顺序（先 added 后 updated）。
 */
export function itemsChangedEvents(
  changes: ItemChanges,
  libraryOf: Map<number, number>
): LibraryEvent[] {
  const byLibrary = new Map<number, ItemChanges>()
  const bucket = (id: number): ItemChanges | undefined => {
    const lib = libraryOf.get(id)
    if (lib === undefined) return undefined
    let c = byLibrary.get(lib)
    if (!c) byLibrary.set(lib, (c = new ItemChanges()))
    return c
  }
  for (const id of changes.added) bucket(id)?.added.add(id)
  for (const id of changes.updated) bucket(id)?.updated.add(id)
  return [...byLibrary].map(([libraryId, c]) => ({
    type: 'items-changed',
    libraryId,
    added: [...c.added],
    updated: [...c.updated],
    removed: [],
    reset: false,
  }))
}

/**
 * 分段推送用：取出 all 里还没推过的变化并记进 emitted（每个 id 只推一次）。
 */
export function takeFreshChanges(
  all: ItemChanges,
  emitted: Set<number>
): ItemChanges {
  const fresh = new ItemChanges()
  for (const id of all.added) if (!emitted.has(id)) fresh.added.add(id)
  for (const id of all.updated) if (!emitted.has(id)) fresh.updated.add(id)
  for (const id of [...fresh.added, ...fresh.updated]) emitted.add(id)
  return fresh
}

/** 存储的候选 → IPC 候选。 */
export function candidateInfo(
  kind: MatchCandidateInfo['kind'],
  id: string,
  c: StoredCandidate,
  confidence: number
): MatchCandidateInfo {
  return {
    provider: 'tmdb',
    kind,
    id,
    title: c.title,
    originalTitle: c.originalTitle ?? null,
    year: c.year ?? null,
    confidence,
    breakdown: c.breakdown ?? {},
    poster: c.posterPath ? TmdbProvider.imageUrl(c.posterPath, 'w185') : null,
    overview: c.overview ?? null,
  }
}

/** 打分候选 → IPC 候选（breakdown 只留数字项，简介截到摘要长度）。 */
export function scoredInfo(s: ScoredCandidate): MatchCandidateInfo {
  const breakdown: Record<string, number> = {}
  for (const [k, v] of Object.entries(s.breakdown)) {
    if (typeof v === 'number') breakdown[k] = v
  }
  return candidateInfo(
    s.candidate.ref.kind,
    s.candidate.ref.id,
    {
      title: s.candidate.title,
      originalTitle: s.candidate.originalTitle,
      year: s.candidate.year,
      posterPath: s.candidate.posterPath,
      overview: s.candidate.overview?.slice(0, OVERVIEW_SUMMARY_MAX),
      breakdown,
    },
    s.score
  )
}

/** 网络 / 令牌错误转成带错误码的 LibraryError。 */
export function toLibraryError(error: unknown): unknown {
  if (error instanceof LibraryError) return error
  if (error instanceof ProviderAuthError) {
    return new LibraryError('invalid-params', error.message)
  }
  return error
}
