import { isIncognito } from '@/features/incognito'
import type { JsonRecord } from '../../../../../shared/json'
import {
  readStoredArray,
  readStoredText,
  saveStoredArray,
  writeStoredText,
} from '@/utils/storage'

import {
  type MediaProgress,
  type ProgressMap,
  parseProgressMap,
  progressOf,
  putProgress,
} from '../../../../../shared/playback/media-progress'
import { readWatched } from '../watched'

const ONLINE_KEY = 'online_play_history'
const PROGRESS_MAP_KEY = 'media_play_progress'

/** 读进度表（键不变：media_play_progress）；没有或坏掉时为空表。 */
function readProgressMap(): ProgressMap {
  try {
    return parseProgressMap(
      JSON.parse(readStoredText(PROGRESS_MAP_KEY) || '{}')
    )
  } catch {
    return {}
  }
}

/**
 * 一个进度键的观看情况：位置与总时长（秒），是否看完（「已看完」集合里的独立标记，
 * 不从位置 0 推断），以及最后一次记录的时间。进度表没有记录且没看完返回 null。
 */
export function readMediaProgress(key: string): MediaProgress | null {
  return progressOf(readProgressMap(), readWatched(), key)
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
  const map = putProgress(
    readProgressMap(),
    key,
    progress,
    duration,
    Date.now()
  )
  if (!map) return
  writeStoredText(PROGRESS_MAP_KEY, JSON.stringify(map))

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
