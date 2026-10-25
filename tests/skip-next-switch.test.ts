// @vitest-environment jsdom
import { effectScope, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type Artplayer from 'artplayer'

import { setSkipMarks } from '../src/renderer/src/features/player/skip/skip-store'
import {
  NEXT_COUNTDOWN,
  useSkipSegments,
} from '../src/renderer/src/features/player/skip/use-skip-segments'
import { singleFlight } from '../src/renderer/src/features/player/utils/single-flight'

vi.mock('@/features/settings', () => ({
  getSetting: (key: string) => key === 'player.autoNext',
}))

/**
 * 切集中：下一集异步解析地址时，「立即播放」/ 倒计时 / 旧视频结束只能真正切一次（PR #117 审查）。
 */

/** 可手动结束的 Promise */
const deferred = (): { promise: Promise<boolean>; done: () => void } => {
  let done = (): void => {}
  const promise = new Promise<boolean>(resolve => {
    done = () => resolve(true)
  })
  return { promise, done }
}

/** 最小的 Artplayer 替身：只有 useSkipSegments 用到的部分 */
const fakeArt = (): {
  art: Artplayer
  video: { currentTime: number; duration: number; paused: boolean }
  emit: (name: string) => void
} => {
  const handlers = new Map<string, (() => void)[]>()
  const video = {
    currentTime: 950,
    duration: 1000,
    paused: false,
    seeking: false,
    pause(): void {
      video.paused = true
    },
  }
  const art = {
    video,
    notice: {},
    template: {},
    on(name: string, fn: () => void): void {
      handlers.set(name, [...(handlers.get(name) || []), fn])
    },
  } as unknown as Artplayer
  const emit = (name: string): void =>
    (handlers.get(name) || []).forEach(fn => fn())
  return { art, video, emit }
}

describe('singleFlight', () => {
  it('进行中再调用复用同一次，结束后才能再执行', async () => {
    const gate = deferred()
    const run = vi.fn(() => gate.promise)
    const next = singleFlight(run)
    const first = next()
    expect(next()).toBe(first)
    expect(next.pending()).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    gate.done()
    await first
    expect(next.pending()).toBe(false)
    void next()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('失败后也会解除进行中', async () => {
    const next = singleFlight(() => Promise.reject(new Error('解析失败')))
    await expect(next()).rejects.toThrow('解析失败')
    expect(next.pending()).toBe(false)
  })
})

describe('useSkipSegments 切集中', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    setSkipMarks('t:A', { outro: 60 })
  })
  afterEach(() => vi.useRealTimers())

  const setup = (
    playNext: () => Promise<boolean>
  ): {
    skip: ReturnType<typeof useSkipSegments>
    player: ReturnType<typeof fakeArt>
    scope: ReturnType<typeof effectScope>
  } => {
    const scope = effectScope()
    const skip = scope.run(() =>
      useSkipSegments({ key: () => 't:A', hasNext: () => true, playNext })
    )!
    const player = fakeArt()
    skip.attach(player.art)
    player.emit('video:timeupdate')
    return { skip, player, scope }
  }

  it('「立即播放」连点只切一次，切完前按钮处于 loading、旧视频暂停', async () => {
    const gate = deferred()
    const playNext = vi.fn(() => gate.promise)
    const { skip, player, scope } = setup(playNext)
    expect(skip.showNext.value).toBe(true)
    skip.playNow()
    skip.playNow()
    expect(playNext).toHaveBeenCalledTimes(1)
    expect(skip.switching.value).toBe(true)
    expect(player.video.paused).toBe(true)
    gate.done()
    await gate.promise
    await nextTick()
    expect(skip.switching.value).toBe(false)
    scope.stop()
  })

  it('倒计时结束后切集中，再点「立即播放」不再切', async () => {
    const gate = deferred()
    const playNext = vi.fn(() => gate.promise)
    const { skip, scope } = setup(playNext)
    await nextTick()
    vi.advanceTimersByTime(NEXT_COUNTDOWN * 1000)
    expect(playNext).toHaveBeenCalledTimes(1)
    expect(skip.switching.value).toBe(true)
    skip.playNow()
    vi.advanceTimersByTime(NEXT_COUNTDOWN * 1000)
    expect(playNext).toHaveBeenCalledTimes(1)
    gate.done()
    scope.stop()
  })

  it('先点「立即播放」，倒计时不会再触发', async () => {
    const gate = deferred()
    const playNext = vi.fn(() => gate.promise)
    const { skip, scope } = setup(playNext)
    await nextTick()
    vi.advanceTimersByTime(3000)
    skip.playNow()
    vi.advanceTimersByTime(NEXT_COUNTDOWN * 1000)
    expect(playNext).toHaveBeenCalledTimes(1)
    gate.done()
    scope.stop()
  })
})

describe('接入（源码）', () => {
  it('PlayerSession 单飞切集并在切集中忽略旧视频 ended；按钮绑定 loading', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = join(__dirname, '../src/renderer/src/features/player')
    const session = readFileSync(
      join(root, 'components/PlayerSession.vue'),
      'utf8'
    )
    expect(session).toContain('const playNext = singleFlight(')
    expect(session).toContain('if (playNext.pending()) return')
    const overlay = readFileSync(join(root, 'skip/SkipOverlay.vue'), 'utf8')
    expect(overlay).toContain(':loading="skip.switching.value"')
  })
})
