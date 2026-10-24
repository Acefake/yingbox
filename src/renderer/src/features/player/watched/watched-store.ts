/**
 * 「已看完」集合的读写：存在 @/utils/storage 的 `media_watched`（数组，最新的在前）。
 *
 * 写入端是播放器的 markFinished（看完一集）；读取端如防剧透、已看标记。规则在 watched-rules.ts。
 * 这份数据不是响应式的：界面跟着「继续播放」记录（看完时同步更新）重算时顺带重读。
 */
import { readStoredArray, saveStoredArray } from '@/utils/storage'

import {
  type WatchedEntry,
  addWatched,
  hasWatched,
  isWatchedEntry,
  removeWatched,
} from './watched-rules'

/** 存储键 */
export const WATCHED_STORAGE_KEY = 'media_watched'

/** 读出全部看完记录（最新的在前）。 */
export function readWatched(): WatchedEntry[] {
  return readStoredArray<WatchedEntry>(WATCHED_STORAGE_KEY, isWatchedEntry)
}

/** 标记一个进度键看完。 */
export function markWatched(key: string, at: number = Date.now()): void {
  if (!key.trim()) return
  saveStoredArray(WATCHED_STORAGE_KEY, addWatched(readWatched(), key, at))
}

/** 取消一个进度键的看完标记。 */
export function unmarkWatched(key: string): void {
  saveStoredArray(WATCHED_STORAGE_KEY, removeWatched(readWatched(), key))
}

/** 这个进度键是否看完过。 */
export function isWatched(key: string): boolean {
  return hasWatched(readWatched(), key)
}
