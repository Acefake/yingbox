// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import type Artplayer from 'artplayer'

import { installPlayerHotkeys } from '../src/renderer/src/features/player/hotkeys/install-hotkeys'

vi.mock('../src/renderer/src/features/player/utils/art-core', () => ({
  claimDblclick: vi.fn(),
}))

/** installPlayerHotkeys 的接线：window 上的 keydown 监听随实例销毁移除（PR #137 审查） */
describe('播放器快捷键接线', () => {
  it('art.destroy 后 window 上的 keydown 不再生效', () => {
    const handlers = new Map<string, Array<(e?: Event) => void>>()
    const video = {
      paused: true,
      duration: 100,
      currentTime: 0,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
    }
    const art = {
      video,
      layers: { add: () => undefined },
      template: { $player: document.createElement('div') },
      on(name: string, fn: (e?: Event) => void): void {
        handlers.set(name, [...(handlers.get(name) || []), fn])
      },
    } as unknown as Artplayer
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    installPlayerHotkeys(art, {
      enabled: () => true,
      next: null,
      pin: null,
      subtitle: () => {},
    })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))
    expect(video.play).toHaveBeenCalledTimes(1)

    handlers.get('destroy')!.forEach(fn => fn())
    const listener = add.mock.calls.find(c => c[0] === 'keydown')![1]
    expect(remove).toHaveBeenCalledWith('keydown', listener)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))
    expect(video.play).toHaveBeenCalledTimes(1)
  })

  it('Artplayer 内置「播放速度」菜单与 < / > 快捷键用同一组档位', async () => {
    vi.doUnmock('../src/renderer/src/features/player/utils/art-core')
    vi.resetModules()
    vi.doMock('@/features/settings', () => ({
      getSetting: () => 1,
      setSetting: async () => {},
    }))
    const { default: Artplayer } = await import('artplayer')
    await import('../src/renderer/src/features/player/utils/art-core')
    const { RATE_STEPS } =
      await import('../src/renderer/src/features/player/hotkeys/hotkey-map')
    expect(Artplayer.PLAYBACK_RATE).toEqual([...RATE_STEPS])
  })
})
