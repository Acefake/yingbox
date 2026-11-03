// @vitest-environment jsdom
// test-affected: repo-wide
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type Artplayer from 'artplayer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  video: {
    paused: boolean
    volume: number
    currentTime: number
    duration: number
    playbackRate: number
  }
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

describe('睡眠定时：后台轮询生命周期', () => {
  let sleep: typeof timer
  const players: FakeArt[] = []
  const install = (): FakeArt => {
    const player = fakeArt()
    players.push(player)
    sleep.installSleepTimer(player.art)
    return player
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    vi.resetModules()
    sleep =
      await import('../src/renderer/src/features/player/sleep/sleep-timer')
  })
  afterEach(() => {
    players.splice(0).forEach(player => player.destroy())
    vi.useRealTimers()
  })

  it('未启用时不安排后台任务，菜单和遥控都能启停定时', () => {
    const player = install()
    expect(vi.getTimerCount()).toBe(0)
    player.pick('episode')
    expect(vi.getTimerCount()).toBe(1)
    player.pick('off')
    expect(vi.getTimerCount()).toBe(0)
    expect(sleep.setSleepChoice(30)).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
    sleep.setSleepChoice(60)
    expect(vi.getTimerCount()).toBe(1)
    sleep.setSleepChoice('off')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('分钟定时按时渐弱并暂停，结束后释放轮询', () => {
    const player = install()
    player.pick(30)
    vi.advanceTimersByTime(1_795_000)
    expect(player.video.volume).toBeCloseTo(0.5)
    expect(player.video.paused).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(player.video.paused).toBe(true)
    expect(player.video.volume).toBe(1)
    expect(sleep.currentSleep()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('本集结束消费定时后停表，新实例不复活已消费的任务', () => {
    const first = install()
    first.pick('episode')
    expect(sleep.consumeSleepAtEnd()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    first.destroy()
    install()
    expect(sleep.currentSleep()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('销毁释放任务，快速换集恢复原截止时间，超时重开则清除', () => {
    const first = install()
    first.pick(30)
    const saved = sleep.currentSleep()
    first.destroy()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    const next = install()
    expect(sleep.currentSleep()).toEqual(saved)
    expect(vi.getTimerCount()).toBe(1)
    next.destroy()
    vi.advanceTimersByTime(10_001)
    install()
    expect(sleep.currentSleep()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
