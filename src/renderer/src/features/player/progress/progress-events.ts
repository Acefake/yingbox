/**
 * 播放会话的进度写入，统一成可序列化的进度事件：
 * - save：记一次位置（媒体库条目上报片库，其余写本地进度表）；
 * - finish：看完一集（媒体库条目在片库记看完，其余续播点清零并记进「已看完」集合）；
 * - continue：「继续播放」记录跟着更新；
 * - flush：立即写出攒着的片库上报（关播放器、切集时）。
 *
 * 默认就地写（网页端播放层、测试）。桌面端播放会话跑在独立的播放器窗口里，那边用 relayProgress
 * 把事件经主进程转给主窗口，由主窗口照同一个 applyProgressEvent 写：片库进度缓存、继续播放列表与
 * 「想看」自动移出等订阅都在主窗口，界面立即跟着变。无痕模式也在写入端判断。
 */
import { isIncognito } from '@/features/incognito'

import type { ProgressUpdate } from '../continue/continue-rules'
import { updateContinue } from '../continue/continue-store'
import { saveMediaProgress } from '../utils/play-progress'
import { markWatched } from '../watched'
import {
  type LibraryRef,
  flushLibraryProgress,
  reportLibraryProgress,
} from './library-sink'

/** 进度记到哪儿：本地进度表的键 + 媒体库标记（有标记时只记片库） */
export interface ProgressTarget {
  key: string
  library?: LibraryRef
}

/** 一次进度写入（可 JSON 序列化，跨窗口转发） */
export type ProgressEvent =
  | { kind: 'save'; target: ProgressTarget; position: number; duration: number }
  | { kind: 'finish'; target: ProgressTarget; duration: number }
  | { kind: 'continue'; id: string; update: ProgressUpdate }
  | { kind: 'flush' }

/** 就地写一条进度事件 */
export function applyProgressEvent(event: ProgressEvent): void {
  switch (event.kind) {
    case 'save': {
      const { target, position, duration } = event
      if (!reportLibraryProgress(target.library, position, duration))
        saveMediaProgress(target.key, position, duration)
      return
    }
    case 'finish': {
      const { target, duration } = event
      if (reportLibraryProgress(target.library, duration, duration, true)) {
        flushLibraryProgress()
        return
      }
      saveMediaProgress(target.key, 0, duration)
      // 无痕模式不记「已看完」（与不写进度、不记历史一致）
      if (!isIncognito()) markWatched(target.key)
      return
    }
    case 'continue':
      updateContinue(event.id, event.update)
      return
    case 'flush':
      flushLibraryProgress()
  }
}

let outlet: (event: ProgressEvent) => void = applyProgressEvent

/** 播放会话写进度都经这里 */
export function emitProgress(event: ProgressEvent): void {
  outlet(event)
}

/**
 * 把进度事件改发到别处（播放器窗口 → 主窗口）。
 * @returns 恢复就地写
 */
export function relayProgress(to: (event: ProgressEvent) => void): () => void {
  outlet = to
  return () => {
    if (outlet === to) outlet = applyProgressEvent
  }
}
