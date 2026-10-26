/**
 * 一次播放会话的进度：节流保存（useProgressSaver）+ 「继续播放」记录跟着更新 + 每集从哪儿开始播。
 *
 * - 媒体库条目（playlist 项带 library）只上报片库，续播位置也从片库取（看完的从头播；播放器窗口里没有
 *   片库缓存，用主窗口开播时填进条目的 libraryResume）；
 * - 其余条目写本地进度表，续播位置读本地进度表；
 * - 只记主线路的位置：备用线路是同一集，下标不变。
 */
import type { Ref } from 'vue'

import { libraryResumeAt } from '../progress/library-sink'
import { emitProgress } from '../progress/progress-events'
import { getMediaProgress } from '../utils/play-progress'
import type { PlaylistEntry } from '../utils/play-queue'
import { type ProgressSaver, useProgressSaver } from './use-progress-saver'

/** useSessionProgress 的输入（PlayerSession 的状态） */
export interface SessionProgressInput {
  progressKey: Ref<string>
  continueId: Ref<string>
  playlist: Ref<PlaylistEntry[]>
  position: Ref<number>
  /** 正在播的条目（主线路或备用线路） */
  current: () => PlaylistEntry | null
  label: (entry: PlaylistEntry | null | undefined) => string
}

/** useSessionProgress 的返回值 */
export interface SessionProgress {
  saver: ProgressSaver
  /**
   * 这一集从哪儿开始播：调用方给了大于 0 的位置就用它，否则媒体库条目看片库、其余看本地进度表。
   * @param seeded 调用方给的位置
   */
  startAt: (seeded?: number) => number
}

export function useSessionProgress(
  input: SessionProgressInput
): SessionProgress {
  const saver = useProgressSaver(
    () => input.progressKey.value,
    Date.now,
    (time, duration, ended) => {
      const { playlist, position } = input
      const id = input.continueId.value
      if (!id) return
      emitProgress({
        kind: 'continue',
        id,
        update: {
          index: position.value,
          episode:
            playlist.value.length > 1
              ? input.label(playlist.value[position.value])
              : undefined,
          progress: time,
          duration,
          ended,
        },
      })
    },
    () => input.current()?.library
  )
  const startAt = (seeded?: number): number => {
    if (typeof seeded === 'number' && seeded > 0) return seeded
    const entry = input.current()
    return (
      entry?.libraryResume ??
      libraryResumeAt(entry?.library) ??
      getMediaProgress(input.progressKey.value)
    )
  }
  return { saver, startAt }
}
