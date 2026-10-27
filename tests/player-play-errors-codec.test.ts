/**
 * 编码 / 格式不受支持的判定：桌面端据此把文件交给 mpv。
 */
import { describe, expect, it } from 'vitest'
import {
  CODEC_UNSUPPORTED,
  FORMAT_UNSUPPORTED,
  isCodecFailure,
  videoErrorReason,
} from '../src/renderer/src/features/player/utils/play-errors'

describe('isCodecFailure', () => {
  it('MediaError 3 / 4（桌面端）算编码失败', () => {
    expect(isCodecFailure(videoErrorReason(3))).toBe(true)
    expect(isCodecFailure(videoErrorReason(4))).toBe(true)
    expect(isCodecFailure(CODEC_UNSUPPORTED)).toBe(true)
    expect(isCodecFailure(FORMAT_UNSUPPORTED)).toBe(true)
  })
  it('网络错误、网页端提示不算', () => {
    expect(isCodecFailure(videoErrorReason(2))).toBe(false)
    expect(isCodecFailure(videoErrorReason(4, true))).toBe(false)
    expect(isCodecFailure('')).toBe(false)
  })
})
