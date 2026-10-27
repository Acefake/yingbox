/**
 * 播放会话里「内置解不了 → 交给 mpv」的状态与动作：失败原因是编码 / 格式不受支持时，
 * 桌面端自动把当前条目交给 mpv 从当前进度接着播，成功就关掉内置播放器；失败留在错误面板给按钮重试。
 */
import { type ComputedRef, type Ref, computed, ref } from 'vue'
import { toast } from '@/components/ui'
import { closePlayer } from '../host/player-host'
import { hasMpvBridge, playEntryInMpv } from '../utils/mpv-handoff'
import { isCodecFailure } from '../utils/play-errors'
import type { PlaylistEntry } from '../utils/play-queue'

export interface MpvHandoffOptions {
  /** 当前条目 */
  entry: () => PlaylistEntry | null
  /** 当前播放地址（在线条目交给 mpv 用解析好的地址） */
  src: () => string
  /** 条目显示名 */
  label: (entry: PlaylistEntry) => string
  /** 当前进度（秒） */
  position: () => number
  /** 交出去之前先存一次进度 */
  flush: () => void
}

export interface MpvHandoff {
  /** 错误面板上要不要显示「用 mpv 播放」 */
  canHandOff: ComputedRef<boolean>
  handingOff: Ref<boolean>
  /** 记下失败原因；是编码问题就自动接力 */
  onFailure: (reason: string) => Promise<void>
  /** 清掉失败状态 */
  reset: () => void
  /** 交给 mpv；manual 为用户点的按钮（失败时弹出原因） */
  handOff: (manual: boolean) => Promise<void>
}

export function useMpvHandoff(options: MpvHandoffOptions): MpvHandoff {
  const codecFailure = ref(false)
  const handingOff = ref(false)
  const canHandOff = computed(
    () => codecFailure.value && hasMpvBridge() && Boolean(options.entry())
  )

  const handOff = async (manual: boolean): Promise<void> => {
    const entry = options.entry()
    if (!entry || handingOff.value) return
    handingOff.value = true
    try {
      const at = options.position()
      options.flush()
      const res = await playEntryInMpv(
        entry.filePath ? { filePath: entry.filePath } : { url: options.src() },
        options.label(entry),
        at
      )
      if (res.success) {
        toast.info('内置播放器解不了这个文件的编码，已改用 mpv 播放')
        closePlayer()
      } else if (manual) toast.error(res.error || 'mpv 打开失败')
    } finally {
      handingOff.value = false
    }
  }

  const onFailure = async (reason: string): Promise<void> => {
    codecFailure.value = isCodecFailure(reason)
    if (canHandOff.value) await handOff(false)
  }

  const reset = (): void => {
    codecFailure.value = false
  }

  return { canHandOff, handingOff, onFailure, reset, handOff }
}
