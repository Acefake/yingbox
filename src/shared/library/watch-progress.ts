/**
 * 观看进度的纯规则：看完判定、一次上报怎么并进已有进度、两份进度谁胜出、跨库同步键。
 *
 * 引擎（watch_progress 表）、片库服务、桌面端同步和渲染层共用，不依赖 Node / Vue。
 */
import type {
  ProgressReport,
  ProgressSyncEntry,
  WatchProgress,
} from './ipc/contract-progress'

/** 播到总时长的这个比例算看完。 */
export const WATCHED_RATIO = 0.9

/** 位置是否已算看完（总时长未知时不判断）。 */
export function reachedWatched(position: number, duration: number): boolean {
  return duration > 0 && position >= duration * WATCHED_RATIO
}

const finite = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0

/**
 * 把一次上报并进已有进度：
 * - 手动标记（watched 给了）直接定看完 / 未看；标成未看同时把位置清零；
 * - 否则播到结尾或过了 WATCHED_RATIO 记看完；之前看完的从头重看仍保留看完；
 * - 时长没报（0）时沿用旧的。
 * @param old 已有进度（没有为 null）
 * @param report 上报
 * @param now 上报没带时间时用的时间
 */
export function applyReport(
  old: WatchProgress | null,
  report: ProgressReport,
  now: number
): WatchProgress {
  const duration = finite(report.duration) || old?.duration || 0
  const position = Math.min(finite(report.position), duration || Infinity)
  const reached = report.ended === true || reachedWatched(position, duration)
  const watched =
    typeof report.watched === 'boolean'
      ? report.watched
      : reached || old?.watched === true
  return {
    itemId: report.itemId,
    fileId: report.fileId ?? old?.fileId ?? null,
    position: report.watched === false ? 0 : position,
    duration,
    watched,
    updatedAt: report.at ?? now,
  }
}

/**
 * 两份进度谁胜出（后写胜出）：incoming 更新时返回 true；时间相同时看 preferIncoming。
 */
export function incomingWins(
  current: Pick<WatchProgress, 'updatedAt'> | null,
  incoming: Pick<WatchProgress, 'updatedAt'>,
  preferIncoming = false
): boolean {
  if (!current) return true
  if (incoming.updatedAt !== current.updatedAt)
    return incoming.updatedAt > current.updatedAt
  return preferIncoming
}

/** 算同步键需要的条目信息。 */
export interface SyncKeySource {
  type: 'movie' | 'episode'
  /** 电影自己的 / 剧的 TMDB id */
  tmdbId: string | null
  season: number | null
  episode: number | null
  /** 播放文件的内容指纹 */
  fingerprint: string | null
}

/** 跨库同步键；对不上任何可移植标识时为 null（这条不同步）。 */
export function progressSyncKey(source: SyncKeySource): string | null {
  const tmdb = source.tmdbId?.trim()
  if (tmdb && source.type === 'movie') return `movie:${tmdb}`
  if (tmdb && source.season !== null && source.episode !== null)
    return `tv:${tmdb}:${source.season}:${source.episode}`
  const fp = source.fingerprint?.trim()
  return fp ? `fp:${fp}` : null
}

/** 同步条目的形状校验（导入边界用）；不合法返回 null。 */
export function parseSyncEntry(raw: unknown): ProgressSyncEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
  const position = num(r.position)
  const duration = num(r.duration)
  const updatedAt = num(r.updatedAt)
  if (
    typeof r.key !== 'string' ||
    !/^(movie|tv|fp):[^\s]{1,200}$/.test(r.key) ||
    position === null ||
    duration === null ||
    updatedAt === null ||
    typeof r.watched !== 'boolean'
  )
    return null
  return { key: r.key, position, duration, watched: r.watched, updatedAt }
}
