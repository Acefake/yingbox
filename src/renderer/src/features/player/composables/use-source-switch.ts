/**
 * 播放中自动换源：卡顿（useStallWatch）或出错时换到同集的下一条备用源，从当前进度继续，
 * 并给出「X 卡顿，已切换到 Y · 从 mm:ss 继续」提示。规则在 utils/source-switch。
 *
 * 续播位置按「一轮换源」保留：从主源开始换的那一刻记下目标位置，之后连续换源（备用源还没开播就失败，
 * 新 <video> 的 currentTime 仍是 0）都用这个位置；直到某个源真正开播（playing）才结束这一轮。
 */
import type { Ref } from 'vue'

import type { PlaylistEntry } from '../utils/play-queue'
import {
  type SwitchReason,
  nextFallbackIndex,
  sourceName,
  switchNotice,
  targetName,
} from '../utils/source-switch'
import { useStallWatch } from './use-stall-watch'

/** useSourceSwitch 的依赖：PlayerSession 的队列状态与动作 */
export interface SourceSwitchDeps {
  fallbacks: Ref<PlaylistEntry[]>
  /** 当前备用源下标；-1 = 主源 */
  activeFallback: Ref<number>
  current: () => PlaylistEntry | null
  notify: (text: string) => void
  /** 按新的 activeFallback 重新加载，从 at 秒继续 */
  load: (at: number) => Promise<void>
}

/** useSourceSwitch 的返回值 */
export interface SourceSwitch {
  /** 换到下一条备用源；没有可换的返回 false */
  switchSource: (reason: SwitchReason) => Promise<boolean>
  /** 盯住新的 <video>（卡顿计时） */
  attach: (video: HTMLVideoElement) => void
  detach: () => void
}

export function useSourceSwitch(deps: SourceSwitchDeps): SourceSwitch {
  /** 本轮换源的目标续播位置（秒）；null = 不在换源中 */
  let resumeAt: number | null = null
  let video: HTMLVideoElement | null = null

  const switchSource = async (reason: SwitchReason): Promise<boolean> => {
    // 从主源换起（含重试 / 连播后）是新的一轮，丢掉上一轮的位置
    if (deps.activeFallback.value < 0) resumeAt = null
    const next = nextFallbackIndex(
      deps.activeFallback.value,
      deps.fallbacks.value.length
    )
    if (next < 0) {
      resumeAt = null
      return false
    }
    const from = deps.current()
    const at = resumeAt ?? stall.currentTime()
    resumeAt = at
    deps.activeFallback.value = next
    const to = deps.fallbacks.value[next]
    deps.notify(
      switchNotice(reason, sourceName(from), targetName(from, to), at)
    )
    await deps.load(at)
    return true
  }

  const stall = useStallWatch(() => {
    void switchSource('stall')
  })

  /** 新源真正开播：这一轮换源结束，之后再卡顿按当时的进度换 */
  const onPlaying = (): void => {
    resumeAt = null
  }

  const detach = (): void => {
    video?.removeEventListener('playing', onPlaying)
    video = null
    stall.detach()
  }

  const attach = (el: HTMLVideoElement): void => {
    detach()
    video = el
    el.addEventListener('playing', onPlaying)
    stall.attach(el)
  }

  return { switchSource, attach, detach }
}
