/**
 * 播放失败的恢复链：杜比视界重建 → 同集备用线路 → mpv 接力 → 可操作的错误面板；以及手动重试。
 * 失败文案与「重试中」状态归这里，会话只负责把依赖接进来。
 */
import type Artplayer from 'artplayer'
import { type Ref, ref } from 'vue'

import type { MpvHandoff } from './use-mpv-handoff'
import type { useDolbyVision } from '../dolby-vision/use-dolby-vision'
import type { PlaylistEntry } from '../utils/play-queue'

export interface UsePlayFailureInput {
  art: Readonly<Ref<Artplayer | null>>
  /** 事件是否来自当前视频（换集退役的旧视频不算） */
  accepts: (event?: Event) => boolean
  startAt: () => number
  dolbyVision: ReturnType<typeof useDolbyVision>
  /** 切到同集下一条备用源；换成了返回 true */
  switchSource: (reason: 'error') => Promise<boolean>
  mpvHandoff: MpvHandoff
  hasFallbacks: () => boolean
  activeFallback: Ref<number>
  current: () => PlaylistEntry | null
  label: (entry: PlaylistEntry | null) => string
  load: (seeded?: undefined, startAt?: number) => Promise<void>
}

export interface UsePlayFailureReturn {
  /** 错误面板文案；空串 = 没有失败 */
  failure: Ref<string>
  failedSource: Ref<string>
  retrying: Ref<boolean>
  /** 恢复播放后清掉错误面板 */
  clearFailure: () => void
  /** 播放失败（含 hls 致命错误） */
  onError: (event?: Event) => Promise<void>
  /** 手动重试：重置备用线路，从当前集重新解析播放 */
  retry: () => Promise<void>
}

export function usePlayFailure(
  input: UsePlayFailureInput
): UsePlayFailureReturn {
  const failure = ref('')
  const failedSource = ref('')
  const retrying = ref(false)

  const clearFailure = (): void => {
    failure.value = ''
    failedSource.value = ''
    input.mpvHandoff.reset()
  }

  const onError = async (event?: Event): Promise<void> => {
    if (!input.accepts(event)) return
    // 杜比视界重建会话出错：退到 mpv，或重新加载同一文件、直接播
    const at = input.art.value?.currentTime || input.startAt()
    const dv = await input.dolbyVision.recover(at)
    if (dv === 'reload') return input.load(undefined, at)
    if (dv) return
    if (await input.switchSource('error')) return
    // 备用线路也失败：给出可操作的错误界面；播放器给了原因（如网页端解不了 HEVC）就直接说
    const reason =
      event instanceof CustomEvent ? String(event.detail ?? '') : ''
    failure.value = input.hasFallbacks()
      ? '当前线路与备用线路均无法播放。'
      : reason && reason !== '播放出错'
        ? reason
        : '无法播放该地址（可能是资源已失效或格式不受支持）。'
    failedSource.value = input.label(input.current())
    // 内置解不了（HEVC / AC3 / EAC3 / DTS 等）：桌面端直接交给 mpv；接力失败才留在错误面板
    await input.mpvHandoff.onFailure(reason)
  }

  const retry = async (): Promise<void> => {
    if (retrying.value) return
    retrying.value = true
    try {
      input.activeFallback.value = -1
      await input.load()
    } finally {
      retrying.value = false
    }
  }

  return { failure, failedSource, retrying, clearFailure, onError, retry }
}
