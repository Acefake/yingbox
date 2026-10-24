import type Artplayer from 'artplayer'
import { describe, expect, it } from 'vitest'

import { installScreenshot } from '../src/renderer/src/features/player/screenshot/screenshot'

/**
 * 截图插件装到精简的 Artplayer 实例上（缺 layers / controls / contextmenu）不抛错，
 * 播放器其余初始化照常进行。
 */
describe('installScreenshot：缺少 Artplayer 组件 API', () => {
  it('没有 layers / controls / contextmenu 也不抛错', () => {
    const handlers: string[] = []
    const art = {
      url: 'https://cdn.example/a.m3u8',
      video: { currentTime: 0 },
      notice: { show: '' },
      on: (name: string) => handlers.push(name),
    } as unknown as Artplayer
    expect(() => installScreenshot(art, true)).not.toThrow()
    expect(handlers).toContain('destroy')
  })
})
