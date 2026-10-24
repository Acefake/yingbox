/**
 * 播放进度的节流保存：timeupdate 每 2 秒最多写一次，窗口关闭 / 切集前 flush，看完清零续播点。
 * 每次写入同时回调 onSave（「继续播放」记录跟着更新）。
 */
import { isIncognito } from '@/features/incognito'
import { saveMediaProgress } from '../utils/play-progress'
import { markWatched } from '../watched'

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
 */
export function useProgressSaver(
  key: () => string,
  now: () => number = Date.now,
  onSave: ProgressListener = () => {}
): ProgressSaver {
  let lastPersist = 0
  let lastTime = 0
  let lastDuration = 0

  const onTimeUpdate = (event: Event): void => {
    const el = event.target as HTMLVideoElement | null
    if (!el || !key()) return
    lastTime = el.currentTime || 0
    lastDuration = Number.isFinite(el.duration) ? el.duration : 0
    const at = now()
    if (at - lastPersist < PERSIST_INTERVAL) return
    lastPersist = at
    saveMediaProgress(key(), lastTime, lastDuration)
    onSave(lastTime, lastDuration, false)
  }

  const flush = (): void => {
    if (!key() || !(lastTime > 1)) return
    saveMediaProgress(key(), lastTime, lastDuration)
    onSave(lastTime, lastDuration, false)
  }

  const markFinished = (video: HTMLVideoElement | null): void => {
    const duration =
      video && Number.isFinite(video.duration) ? video.duration : lastDuration
    if (key()) {
      saveMediaProgress(key(), 0, duration)
      // 无痕模式不记「已看完」（与不写进度、不记历史一致）
      if (!isIncognito()) markWatched(key())
      onSave(duration, duration, true)
    }
    lastTime = 0
  }

  const reset = (): void => {
    lastTime = 0
    lastDuration = 0
  }

  return { onTimeUpdate, flush, markFinished, reset }
}
