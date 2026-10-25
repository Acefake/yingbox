import { isIncognito } from '@/features/incognito'
import type { JsonRecord } from '@/utils/json'
import { readStoredArray, saveStoredArray } from '@/utils/storage'

import { readWatched } from '../watched'

const ONLINE_KEY = 'online_play_history'
const PROGRESS_MAP_KEY = 'media_play_progress'

type ProgressMap = Record<
  string,
  { progress: number; duration: number; updatedAt: number }
>

function readProgressMap(): ProgressMap {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_MAP_KEY) || '{}')
    return raw && typeof raw === 'object' ? (raw as ProgressMap) : {}
  } catch {
    return {}
  }
}

function writeProgressMap(map: ProgressMap): void {
  try {
    localStorage.setItem(PROGRESS_MAP_KEY, JSON.stringify(map))
  } catch (error) {
    console.warn('[play-progress] map save failed', error)
  }
}

/** Prefer URL / filePath as stable key. */
export function mediaProgressKey(input: {
  url?: string
  filePath?: string
}): string {
  const url = typeof input.url === 'string' ? input.url.trim() : ''
  const filePath =
    typeof input.filePath === 'string' ? input.filePath.trim() : ''
  return url || filePath
}

/**
 * 一个进度键的观看情况：位置与总时长（秒），是否看完（「已看完」集合里的独立标记，
 * 不从位置 0 推断），以及最后一次记录的时间。进度表没有记录且没看完返回 null。
 */
export function readMediaProgress(key: string): {
  progress: number
  duration: number
  finished: boolean
  updatedAt: number
} | null {
  const hit = key ? readProgressMap()[key] : undefined
  const watched = key
    ? readWatched().find(e => e.key === key.trim())
    : undefined
  const has = !!hit && typeof hit.progress === 'number'
  if (!has && !watched) return null
  return {
    progress: has ? hit.progress : 0,
    duration: has && typeof hit.duration === 'number' ? hit.duration : 0,
    finished: !!watched,
    updatedAt: Math.max(
      has && typeof hit.updatedAt === 'number' ? hit.updatedAt : 0,
      watched?.at ?? 0
    ),
  }
}

export function getMediaProgress(key: string): number {
  if (!key) return 0
  const mapped = readProgressMap()[key]?.progress
  if (typeof mapped === 'number' && mapped > 0) return mapped
  const history = readStoredArray<JsonRecord>(ONLINE_KEY)
  const hit = history.find(entry => entry?.url === key)
  return typeof hit?.progress === 'number' ? hit.progress : 0
}

export function saveMediaProgress(
  key: string,
  progress: number,
  duration = 0
): void {
  // 无痕模式不留续播进度
  if (!key || isIncognito()) return
  if (!Number.isFinite(progress) || progress < 0) return

  const map = readProgressMap()
  map[key] = {
    progress,
    duration: Number.isFinite(duration) ? duration : 0,
    updatedAt: Date.now(),
  }
  // keep map bounded
  const entries = Object.entries(map)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, 80)
  writeProgressMap(Object.fromEntries(entries))

  const history = readStoredArray<JsonRecord>(ONLINE_KEY)
  const index = history.findIndex(entry => entry?.url === key)
  if (index < 0) return
  const next = {
    ...history[index],
    progress,
    duration: Number.isFinite(duration)
      ? duration
      : history[index].duration || 0,
    timestamp: Date.now(),
  }
  const rest = history.filter((_, i) => i !== index)
  saveStoredArray(ONLINE_KEY, [next, ...rest].slice(0, 30))
}
