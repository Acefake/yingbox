/**
 * 一次播放会话的进度：节流保存（useProgressSaver）+ 「继续播放」记录跟着更新 + 每集从哪儿开始播。
 *
 * - 媒体库条目（playlist 项带 library）只上报片库，续播位置也从片库取（看完的从头播；播放器窗口里没有
 *   片库缓存，用主窗口开播时填进条目的 libraryResume）；
 * - 其余条目写本地进度表，续播位置读本地进度表；
 * - 只记主线路的位置：备用线路是同一集，下标不变；
 * - 进度记到「开播时绑定的那一集」（bind）：换集时先把上一集的位置写出再解绑（release），解析下一集地址期间
 *   旧视频还在播，它的 timeupdate 不会记到新的一集上。
 */
import type { Ref } from 'vue'

import { type LibraryRef, libraryResumeAt } from '../progress/library-sink'
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

/** 正在记进度的那一集（开播时的快照） */
interface BoundEntry {
  key: string
  library?: LibraryRef
  index: number
  episode?: string
}

/** useSessionProgress 的返回值 */
export interface SessionProgress {
  saver: ProgressSaver
  /** 当前条目开播（地址已交给播放器）：之后的进度记到这一集 */
  bind: () => void
  /** 换集 / 重新加载前：写出上一集的位置并解绑，加载完成前的进度事件一律不记 */
  release: () => void
  /**
   * 这一集从哪儿开始播：调用方给了大于 0 的位置就用它，否则媒体库条目看片库、其余看本地进度表。
   * @param seeded 调用方给的位置
   */
  startAt: (seeded?: number) => number
}

export function useSessionProgress(
  input: SessionProgressInput
): SessionProgress {
  let bound: BoundEntry | null = null
  const saver = useProgressSaver(
    () => bound?.key ?? '',
    Date.now,
    (time, duration, ended) => {
      const id = input.continueId.value
      if (!id || !bound) return
      emitProgress({
        kind: 'continue',
        id,
        update: {
          index: bound.index,
          episode: bound.episode,
          progress: time,
          duration,
          ended,
        },
      })
    },
    () => bound?.library
  )
  const bind = (): void => {
    const { playlist, position } = input
    bound = {
      key: input.progressKey.value,
      library: input.current()?.library,
      index: position.value,
      episode:
        playlist.value.length > 1
          ? input.label(playlist.value[position.value])
          : undefined,
    }
  }
  const release = (): void => {
    saver.flush()
    bound = null
    saver.reset()
  }
  const startAt = (seeded?: number): number => {
    if (typeof seeded === 'number' && seeded > 0) return seeded
    const entry = input.current()
    return (
      entry?.libraryResume ??
      libraryResumeAt(entry?.library) ??
      getMediaProgress(input.progressKey.value)
    )
  }
  return { saver, bind, release, startAt }
}
