/**
 * 播放中自动换源：卡顿（useStallWatch）或出错时换到同集的下一条备用源，从当前进度继续，
 * 并给出「X 卡顿，已切换到 Y · 从 mm:ss 继续」提示。规则在 utils/source-switch。
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
  const switchSource = async (reason: SwitchReason): Promise<boolean> => {
    const next = nextFallbackIndex(
      deps.activeFallback.value,
      deps.fallbacks.value.length
    )
    if (next < 0) return false
    const from = deps.current()
    const at = stall.currentTime()
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

  return { switchSource, attach: stall.attach, detach: stall.detach }
}
