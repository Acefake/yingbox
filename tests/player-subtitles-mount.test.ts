// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import type Artplayer from 'artplayer'

import { usePlayerSubtitles } from '../src/renderer/src/features/player/composables/use-player-subtitles'

/** 字幕挂载在 subtitle.switch 等待期间切集 / 关弹窗：结果丢弃、blob URL 释放（PR #137 审查） */
describe('字幕挂载与切集', () => {
  it('switch 返回前已切集：不复活上一集的字幕轨，blob URL 被释放', async () => {
    let finish = (): void => {}
    const instance = {
      subtitle: {
        show: false,
        switch: vi.fn(
          () => new Promise<void>(resolve => (finish = () => resolve()))
        ),
      },
      notice: { show: '' },
    } as unknown as Artplayer
    let current: Artplayer | null = instance
    const created: string[] = []
    const revoked: string[] = []
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:${created.length}`
      created.push(url)
      return url
    })
    URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url))
    window.api = {
      subtitle: { read: async () => ({ success: true, data: 'WEBVTT\n' }) },
    } as never

    const subs = usePlayerSubtitles({
      player: () => current,
      search: () => ({ title: '' }),
    })
    const applying = subs.applyFile('/m/a.srt', 'a.srt')
    await vi.waitFor(() => expect(instance.subtitle.switch).toHaveBeenCalled())
    // 切集：旧实例销毁、字幕状态清空
    subs.dispose()
    current = null
    finish()
    expect(await applying).toBe(false)
    expect(subs.tracks.value).toEqual([])
    expect(subs.active.value).toBeNull()
    expect(revoked).toEqual(created)
    expect(instance.subtitle.show).toBe(false)
  })
})
