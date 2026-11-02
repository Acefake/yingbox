/**
 * 非片库条目（在线、AV、本地文件）的续播进度表：键是播放地址或文件路径。
 * 桌面与网页存在 localStorage（media_play_progress），安卓经服务端存在 sqlite；规则只有这一份。
 */
import type { WatchedEntry } from './watched-rules'

/** 一条进度 */
export interface MediaProgressEntry {
  progress: number
  duration: number
  updatedAt: number
}

/** 进度表：键 → 进度 */
export type ProgressMap = Record<string, MediaProgressEntry>

/** 最多留多少条（按更新时间丢最旧的） */
export const PROGRESS_LIMIT = 80

/** 某个键的观看情况（进度表与「已看完」集合合起来） */
export interface MediaProgress {
  progress: number
  duration: number
  /** 「已看完」集合里的独立标记，不从位置推断 */
  finished: boolean
  updatedAt: number
}

/** 进度键：优先播放地址，其次文件路径 */
export function mediaProgressKey(input: {
  url?: string
  filePath?: string
}): string {
  const url = typeof input.url === 'string' ? input.url.trim() : ''
  const filePath =
    typeof input.filePath === 'string' ? input.filePath.trim() : ''
  return url || filePath
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/** 读回存储时校验：形状不对的条目丢掉 */
export function parseProgressMap(raw: unknown): ProgressMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw).filter((pair): pair is [string, MediaProgressEntry] => {
      const value: unknown = pair[1]
      if (!value || typeof value !== 'object') return false
      const v = value as Record<string, unknown>
      return isCount(v.progress) && isCount(v.duration) && isCount(v.updatedAt)
    })
  )
}

/** 记一次进度；位置不合法时返回 null（不改） */
export function putProgress(
  map: ProgressMap,
  key: string,
  progress: number,
  duration: number,
  now: number
): ProgressMap | null {
  if (!key || !isCount(progress)) return null
  const entries = Object.entries({
    ...map,
    [key]: {
      progress,
      duration: isCount(duration) ? duration : 0,
      updatedAt: now,
    },
  })
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, PROGRESS_LIMIT)
  return Object.fromEntries(entries)
}

/** 某个键的观看情况；进度表没有记录且没看完时为 null */
export function progressOf(
  map: ProgressMap,
  watched: readonly WatchedEntry[],
  key: string
): MediaProgress | null {
  const hit = key && Object.hasOwn(map, key) ? map[key] : undefined
  const done = key ? watched.find(e => e.key === key.trim()) : undefined
  if (!hit && !done) return null
  return {
    progress: hit?.progress ?? 0,
    duration: hit?.duration ?? 0,
    finished: !!done,
    updatedAt: Math.max(hit?.updatedAt ?? 0, done?.at ?? 0),
  }
}
