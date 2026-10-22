import { describe, expect, it } from 'vitest'

import {
  closeInlinePlayer,
  inlinePlayback,
  openInlinePlayer,
} from '../src/renderer/src/features/player/inline/inline-player'

describe('应用内播放器的状态', () => {
  it('打开即在播，换片替换载荷，关闭清空', () => {
    const playback = inlinePlayback()
    expect(playback.value).toBeNull()

    openInlinePlayer({ filePath: 'C:/v/a.mp4', title: '甲' })
    expect(playback.value).toEqual({ filePath: 'C:/v/a.mp4', title: '甲' })

    const first = playback.value
    openInlinePlayer({ url: 'https://a/b.m3u8', title: '乙' })
    expect(playback.value).not.toBe(first)
    expect(playback.value?.title).toBe('乙')

    closeInlinePlayer()
    expect(playback.value).toBeNull()
  })

  it('同一载荷再次打开也会换新对象，播放会话重新开始', () => {
    const payload = { filePath: 'C:/v/a.mp4' }
    openInlinePlayer(payload)
    const first = inlinePlayback().value
    openInlinePlayer(payload)
    expect(inlinePlayback().value).not.toBe(first)
    closeInlinePlayer()
  })
})
