import { describe, expect, it } from 'vitest'

import {
  qualityBadge,
  volumeAt,
  volumePercent,
} from '../src/renderer/src/features/player/utils/art-skin'

describe('播放器控制栏皮肤', () => {
  it('清晰度角标按视频高度判断', () => {
    expect(qualityBadge(480)).toBe('')
    expect(qualityBadge(720)).toBe('HD')
    expect(qualityBadge(1080)).toBe('HD')
    expect(qualityBadge(1440)).toBe('2K')
    expect(qualityBadge(2160)).toBe('4K')
    expect(qualityBadge(Number.NaN)).toBe('')
  })

  it('音量百分比：静音为 0，取整并夹在 0–100', () => {
    expect(volumePercent(1, false)).toBe(100)
    expect(volumePercent(0.456, false)).toBe(46)
    expect(volumePercent(0.8, true)).toBe(0)
    expect(volumePercent(2, false)).toBe(100)
  })

  it('指针位置换算成音量', () => {
    expect(volumeAt(150, 100, 100)).toBe(0.5)
    expect(volumeAt(50, 100, 100)).toBe(0)
    expect(volumeAt(300, 100, 100)).toBe(1)
    expect(volumeAt(150, 100, 0)).toBe(0)
  })
})
