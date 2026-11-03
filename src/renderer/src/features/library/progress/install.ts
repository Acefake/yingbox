/**
 * 应用入口调一次：把播放器的媒体库进度去向接到片库（progress-cache），启动后从片库补一次继续播放，
 * 桌面端同步拉下新进度时重读缓存、再补一次；关窗口前写出攒着的上报。
 */
import { setLibraryProgressSink } from '@/features/player'

import { subscribeLibraryEvents } from '../state/library-events'
import { hydrateContinue, pruneMissingContinue } from './continue-source'
import {
  flushProgress,
  reloadProgress,
  reportProgress,
  resumeAt,
} from './progress-cache'

/** 启动后多久补继续播放（不和首屏请求抢）。 */
const HYDRATE_DELAY = 2500
/** 条目被删（移除媒体库、重扫）后多久清继续播放里失效的记录；一次移除会连发几条事件。 */
const PRUNE_DELAY = 500

let installed = false
let pruneTimer: ReturnType<typeof setTimeout> | undefined

/** 条目被删或整体重拉时，清掉继续播放里指向已不存在作品的记录。 */
function pruneOnItemsGone(): void {
  subscribeLibraryEvents(event => {
    if (event.type !== 'items-changed') return
    if (!event.reset && event.removed.length === 0) return
    clearTimeout(pruneTimer)
    pruneTimer = setTimeout(() => void pruneMissingContinue(), PRUNE_DELAY)
  })
}

export function installLibraryProgress(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  setLibraryProgressSink({
    resumeAt,
    report: reportProgress,
    flush: () => void flushProgress(),
  })
  window.addEventListener('beforeunload', () => void flushProgress())
  setTimeout(() => void hydrateContinue(), HYDRATE_DELAY)
  pruneOnItemsGone()
  window.api?.progressSync?.onApplied(() => {
    void reloadProgress().then(hydrateContinue)
  })
}
