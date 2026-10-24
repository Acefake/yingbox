/**
 * 卡顿监测：盯住当前 <video>，开播后一旦进入缓冲（waiting）且持续超过设置的秒数，回调 onStall。
 *
 * - 只在开播（playing）之后计时：首次加载慢交给出错 / 换源逻辑，不算卡顿；
 * - 恢复播放、暂停、换片（emptied）都会取消计时；
 * - 开关与秒数读设置 online.autoSwitchSource / online.stallSeconds（每次开始计时时读，改了立即生效）。
 * 每次换 <video> 调 attach，会话结束调 detach。
 */
import { getSetting } from '@/features/settings'

import { isStalled } from '../utils/source-switch'

/** useStallWatch 的返回值 */
export interface StallWatch {
  /** 盯住一个新的 <video>（会先解除上一个） */
  attach: (video: HTMLVideoElement) => void
  /** 解除监听、取消计时 */
  detach: () => void
  /** 当前播放位置（秒）；没有 <video> 时为 0 */
  currentTime: () => number
}

/** 有足够数据继续播放的 readyState（HAVE_FUTURE_DATA） */
const HAVE_FUTURE_DATA = 3

export function useStallWatch(onStall: () => void): StallWatch {
  let video: HTMLVideoElement | null = null
  let started = false
  let waitingSince = 0
  let timer: number | undefined

  const cancel = (): void => {
    waitingSince = 0
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
  }

  const check = (): void => {
    timer = undefined
    const el = video
    if (!el || el.paused || el.readyState >= HAVE_FUTURE_DATA) return cancel()
    if (!isStalled(waitingSince, Date.now(), getSetting('online.stallSeconds')))
      return
    cancel()
    onStall()
  }

  const onWaiting = (): void => {
    if (!started || waitingSince || !getSetting('online.autoSwitchSource'))
      return
    waitingSince = Date.now()
    timer = window.setTimeout(check, getSetting('online.stallSeconds') * 1000)
  }
  const onPlaying = (): void => {
    started = true
    cancel()
  }
  const onReset = (): void => {
    started = false
    cancel()
  }

  const listeners: [string, () => void][] = [
    ['waiting', onWaiting],
    ['stalled', onWaiting],
    ['playing', onPlaying],
    ['pause', cancel],
    ['emptied', onReset],
  ]

  const detach = (): void => {
    cancel()
    if (video)
      for (const [name, fn] of listeners) video.removeEventListener(name, fn)
    video = null
    started = false
  }

  const attach = (el: HTMLVideoElement): void => {
    detach()
    video = el
    for (const [name, fn] of listeners) el.addEventListener(name, fn)
  }

  const currentTime = (): number => {
    const time = video?.currentTime ?? 0
    return Number.isFinite(time) ? time : 0
  }

  return { attach, detach, currentTime }
}
