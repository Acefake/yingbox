/**
 * 播放进度的节流保存：timeupdate 每 2 秒最多写一次，窗口关闭 / 切集前 flush，看完清零续播点。
 * 每次写入同时回调 onSave（「继续播放」记录跟着更新）。
 * 写入一律发成进度事件（progress/progress-events）：媒体库条目只上报片库，其余写本地进度表与「已看完」集合。
 */
import type { LibraryRef } from '../progress/library-sink'
import { emitProgress } from '../progress/progress-events'

/** 两次写入之间的最短间隔（毫秒） */
const PERSIST_INTERVAL = 2000

/** useProgressSaver 的返回值 */
export interface ProgressSaver {
  /** 绑定到播放器的 timeupdate */
  onTimeUpdate: (event: Event) => void
  /** 立即写入最后一次的位置（超过 1 秒才写） */
  flush: () => void
  /** 看完：把续播点清零（下次从头播放），并记入「已看完」集合（无痕模式不记） */
  markFinished: (video: HTMLVideoElement | null) => void
  /** 切集时清掉上一集的位置 */
  reset: () => void
}

/** 每次写入后的回调：位置、总时长、是否播到结尾 */
export type ProgressListener = (
  progress: number,
  duration: number,
  ended: boolean
) => void

/**
 * 创建进度保存器。
 * @param key 当前条目的进度键（空串表示不记录）
 * @param now 取当前时间（测试可替换）
 * @param onSave 每次写入后回调
 * @param library 当前条目的媒体库标记（不是媒体库条目时为 undefined）
 */
export function useProgressSaver(
  key: () => string,
  now: () => number = Date.now,
  onSave: ProgressListener = () => {},
  library: () => LibraryRef | undefined = () => undefined
): ProgressSaver {
  let lastPersist = 0
  let lastTime = 0
  let lastDuration = 0
  /** 正在记的视频元素：flush 时直接读它的位置（刚拖动完、timeupdate 还没到就关窗也不丢） */
  let video: HTMLVideoElement | null = null

  /** 写一次：媒体库条目交给片库，其余写本地进度表 */
  const persist = (position: number, duration: number): void => {
    emitProgress({
      kind: 'save',
      target: { key: key(), library: library() },
      position,
      duration,
    })
  }

  const onTimeUpdate = (event: Event): void => {
    const el = event.target as HTMLVideoElement | null
    if (!el || !key()) return
    video = el
    lastTime = el.currentTime || 0
    lastDuration = Number.isFinite(el.duration) ? el.duration : 0
    const at = now()
    if (at - lastPersist < PERSIST_INTERVAL) return
    lastPersist = at
    persist(lastTime, lastDuration)
    onSave(lastTime, lastDuration, false)
  }

  const flush = (): void => {
    if (video) {
      lastTime = video.currentTime || lastTime
      if (Number.isFinite(video.duration)) lastDuration = video.duration
    }
    if (!key() || !(lastTime > 1)) return
    persist(lastTime, lastDuration)
    onSave(lastTime, lastDuration, false)
    emitProgress({ kind: 'flush' })
  }

  const markFinished = (video: HTMLVideoElement | null): void => {
    const duration =
      video && Number.isFinite(video.duration) ? video.duration : lastDuration
    if (key()) {
      emitProgress({
        kind: 'finish',
        target: { key: key(), library: library() },
        duration,
      })
      onSave(duration, duration, true)
    }
    lastTime = 0
    video = null
  }

  const reset = (): void => {
    lastTime = 0
    lastDuration = 0
    video = null
  }

  return { onTimeUpdate, flush, markFinished, reset }
}
