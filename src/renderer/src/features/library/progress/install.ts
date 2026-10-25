/**
 * 应用入口调一次：把播放器的媒体库进度去向接到片库（progress-cache），启动后从片库补一次继续播放，
 * 桌面端同步拉下新进度时重读缓存、再补一次；关窗口前写出攒着的上报。
 */
import { setLibraryProgressSink } from '@/features/player'

import { hydrateContinue } from './continue-source'
import {
  flushProgress,
  reloadProgress,
  reportProgress,
  resumeAt,
} from './progress-cache'

/** 启动后多久补继续播放（不和首屏请求抢）。 */
const HYDRATE_DELAY = 2500

let installed = false

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
  window.api?.progressSync?.onApplied(() => {
    void reloadProgress().then(hydrateContinue)
  })
}
