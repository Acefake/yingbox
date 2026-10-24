// @vitest-environment jsdom
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type Artplayer from 'artplayer'

import { createCountdown } from '../src/renderer/src/features/player/skip/next-countdown'
import {
  ENDED_COUNTDOWN,
  useSkipSegments,
} from '../src/renderer/src/features/player/skip/use-skip-segments'

vi.mock('@/features/settings', () => ({ getSetting: () => false }))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createCountdown', () => {
  it('每秒减一，到 0 只触发一次完成', () => {
    const ticks: number[] = []
    const done = vi.fn()
    const c = createCountdown({ onTick: n => ticks.push(n), onDone: done })
    c.start(3)
    expect(c.running()).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(ticks).toEqual([3, 2, 1, 0])
    expect(done).toHaveBeenCalledTimes(1)
    expect(c.running()).toBe(false)
  })

  it('暂停时不走，取消后不触发完成', () => {
    let paused = true
    const done = vi.fn()
    const c = createCountdown({
      onTick: () => {},
      onDone: done,
      paused: () => paused,
    })
    c.start(2)
    vi.advanceTimersByTime(3000)
    expect(done).not.toHaveBeenCalled()
    paused = false
    vi.advanceTimersByTime(1000)
    c.stop()
    vi.advanceTimersByTime(5000)
    expect(done).not.toHaveBeenCalled()
  })

  it('重新开始会从头计时', () => {
    const ticks: number[] = []
    const c = createCountdown({ onTick: n => ticks.push(n), onDone: () => {} })
    c.start(5)
    vi.advanceTimersByTime(2000)
    c.start(5)
    expect(ticks.at(-1)).toBe(5)
  })
})

/** useSkipSegments 用到的最小 Artplayer 替身 */
const fakeArt = (): { art: Artplayer; video: { paused: boolean } } => {
  const video = {
    currentTime: 1000,
    duration: 1000,
    paused: true,
    seeking: false,
    pause(): void {
      video.paused = true
    },
  }
  const art = {
    video,
    notice: {},
    template: {},
    /** 本测试不关心事件订阅 */
    on: vi.fn(),
  } as unknown as Artplayer
  return { art, video }
}

describe('播完自动下一集倒计时', () => {
  it('播完（没有片尾标记）出现卡片，视频已停也照常倒计时，到点切一次', async () => {
    const scope = effectScope()
    const ended = ref(false)
    const playNext = vi.fn(async () => true)
    const skip = scope.run(() =>
      useSkipSegments({
        key: () => 'c:demo',
        hasNext: () => true,
        playNext,
        ended: () => ended.value,
      })
    )!
    skip.attach(fakeArt().art)
    expect(skip.showNext.value).toBe(false)
    ended.value = true
    await nextTick()
    expect(skip.showNext.value).toBe(true)
    expect(skip.countdown.value).toBe(ENDED_COUNTDOWN)
    vi.advanceTimersByTime(ENDED_COUNTDOWN * 1000 + 500)
    await Promise.resolve()
    expect(playNext).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('取消后卡片消失、不切集', async () => {
    const scope = effectScope()
    const ended = ref(true)
    const playNext = vi.fn(async () => true)
    const onCancel = vi.fn()
    const skip = scope.run(() =>
      useSkipSegments({
        key: () => 'c:demo',
        hasNext: () => true,
        playNext,
        ended: () => ended.value,
        onCancelEnded: onCancel,
      })
    )!
    skip.attach(fakeArt().art)
    await nextTick()
    expect(skip.showNext.value).toBe(true)
    skip.watchCredits()
    await nextTick()
    expect(skip.showNext.value).toBe(false)
    expect(onCancel).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(20_000)
    expect(playNext).not.toHaveBeenCalled()
    scope.stop()
  })

  it('没有下一集时播完不出现卡片', async () => {
    const scope = effectScope()
    const skip = scope.run(() =>
      useSkipSegments({
        key: () => 'c:demo',
        hasNext: () => false,
        playNext: async () => false,
        ended: () => true,
      })
    )!
    skip.attach(fakeArt().art)
    await nextTick()
    expect(skip.showNext.value).toBe(false)
    scope.stop()
  })
})
