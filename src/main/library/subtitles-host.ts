/**
 * 主进程替媒体库引擎代办的自动字幕设置（引擎侧见 engine/host-calls.ts 的 hostSubtitleSettings）：
 * 开关与每日上限是普通设置 subtitles.auto.*，引擎每一轮开始前来要一次，改了设置下一轮生效。
 */
import { settingsStore } from '../settings'
import { LIBRARY_HOST_METHODS } from './engine/host-calls'
import type { AutoSubtitleSettings } from './subtitles/auto-subtitles'

/** 自动字幕设置的代办方法表（交给 UtilityHost 的 host 选项）。 */
export function librarySubtitlesHost(): Record<
  string,
  () => Promise<AutoSubtitleSettings>
> {
  return {
    [LIBRARY_HOST_METHODS.subtitleSettings]: async () => {
      const store = settingsStore()
      return {
        enabled: store.get('subtitles.auto.enabled'),
        dailyLimit: store.get('subtitles.auto.dailyLimit'),
      }
    },
  }
}
