// @vitest-environment jsdom
// test-affected: repo-wide
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type Artplayer from 'artplayer'
import { describe, expect, it, vi } from 'vitest'

/**
 * 睡眠定时与播放结束：拖到结尾或错过片尾轮询时，ended 先到，
 * 连播入口要同步消费定时、停在本集，新实例也不再沿用已消费的「看完本集」。
 */

vi.mock('../src/renderer/src/features/player/utils/art-options', () => ({
  artIcon: () => '',
}))

const timer =
  await import('../src/renderer/src/features/player/sleep/sleep-timer')

interface FakeArt {
  art: Artplayer
  pick: (value: unknown) => void
  destroy: () => void
  video: { paused: boolean; volume: number }
}

/** 只实现 installSleepTimer 用到的 Artplayer 接口 */
function fakeArt(): FakeArt {
  const handlers: Record<string, (() => void)[]> = {}
  let onSelect: ((item: { value: unknown }) => unknown) | undefined
  const video = {
    paused: false,
    volume: 1,
    currentTime: 10,
    duration: 100,
    playbackRate: 1,
    pause(): void {
      video.paused = true
    },
  }
  const art = {
    video,
    notice: { show: '' },
    setting: {
      add(config: { onSelect: typeof onSelect }): void {
        onSelect = config.onSelect
      },
      update: vi.fn(),
      find: () => undefined,
    },
    on(name: string, fn: () => void): void {
      ;(handlers[name] ||= []).push(fn)
    },
  } as unknown as Artplayer
  return {
    art,
    video,
    pick: value => onSelect?.({ value }),
    destroy: () => handlers.destroy?.forEach(fn => fn()),
  }
}

describe('睡眠定时：播放结束时同步消费', () => {
  it('看完本集：ended 时消费定时，换集后的新实例不再沿用', () => {
    const first = fakeArt()
    timer.installSleepTimer(first.art)
    first.pick('episode')
    expect(timer.currentSleep()).toEqual({ mode: 'episode' })

    expect(timer.consumeSleepAtEnd()).toBe(true)
    expect(timer.currentSleep()).toBeNull()
    expect(first.art.setting.update).toHaveBeenCalled()
    expect(timer.consumeSleepAtEnd()).toBe(false)

    first.destroy()
    const next = fakeArt()
    timer.installSleepTimer(next.art)
    expect(timer.currentSleep()).toBeNull()
    expect(timer.consumeSleepAtEnd()).toBe(false)
    next.destroy()
  })

  it('按分钟未到点：ended 时不消费，照常连播', () => {
    const a = fakeArt()
    timer.installSleepTimer(a.art)
    a.pick(30)
    expect(timer.consumeSleepAtEnd()).toBe(false)
    expect(timer.currentSleep()?.mode).toBe('minutes')
    expect(timer.consumeSleepAtEnd(Date.now() + 1_800_001)).toBe(true)
    expect(timer.currentSleep()).toBeNull()
    a.destroy()
  })

  it('PlayerSession 的 onEnded 在 playNext 之前同步检查睡眠定时', () => {
    const src = readFileSync(
      resolve(
        __dirname,
        '../src/renderer/src/features/player/components/PlayerSession.vue'
      ),
      'utf8'
    )
    const body = src.slice(src.indexOf('const onEnded'))
    const consume = body.indexOf('consumeSleepAtEnd()')
    expect(consume).toBeGreaterThan(-1)
    expect(consume).toBeLessThan(body.indexOf('playNext()'))
  })
})
