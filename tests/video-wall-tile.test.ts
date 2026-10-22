// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type FrameQuality,
  type WallTile,
  createWallTile,
  isStrained,
} from '../src/renderer/src/features/library/video-wall/wall-tile'
import type { PreviewMedia } from '../src/renderer/src/components/ui/hover-preview'

/**
 * 视频墙的一格（DOM）：真放视频的格静音循环片段（从 10% 起、只播 clipSeconds 秒，播完通知换片）；
 * 不占播放名额或只有图的格轮播图片、停留一段后换片；解码失败退回图片并报告；卡顿 / 掉帧报告降级；
 * 暂停 / 继续；释放时清掉 video 的 src 再 load()。
 */

const calls: string[] = []
let host: HTMLElement
let tile: WallTile
const cb = { onDone: vi.fn(), onFailed: vi.fn(), onStrain: vi.fn() }

const video = (): HTMLVideoElement | null => host.querySelector('video')
const image = (): HTMLImageElement | null => host.querySelector('img')

function setDuration(el: HTMLVideoElement, seconds: number): void {
  Object.defineProperty(el, 'duration', { configurable: true, value: seconds })
}

const clip: PreviewMedia = {
  kind: 'video',
  url: 'local://movie.mp4',
  startRatio: 0.1,
  clipSeconds: 6,
  fallback: ['a.jpg', 'b.jpg'],
}

beforeEach(() => {
  vi.useFakeTimers()
  calls.length = 0
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    calls.push(`play:${this.getAttribute('src') ?? ''}`)
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function () {
    calls.push('pause')
  }
  HTMLMediaElement.prototype.load = function (this: HTMLMediaElement) {
    calls.push(`load:${this.getAttribute('src') ?? ''}`)
  }
  document.body.innerHTML = '<div class="tile"></div>'
  host = document.querySelector('.tile') as HTMLElement
  for (const fn of Object.values(cb)) fn.mockReset()
  tile = createWallTile(host, cb, { dwellMs: 6000, stallMs: 3000 })
})

afterEach(() => {
  tile.release()
  vi.useRealTimers()
})

describe('真放视频的格', () => {
  it('静音、内联、关画中画；从片长 10% 起播', () => {
    tile.show(clip, true)
    const el = video()!
    expect(el.muted).toBe(true)
    expect(el.playsInline).toBe(true)
    expect(el.hasAttribute('disablepictureinpicture')).toBe(true)
    expect(el.getAttribute('src')).toBe('local://movie.mp4')
    expect(calls).toContain('play:local://movie.mp4')
    setDuration(el, 1000)
    el.dispatchEvent(new Event('loadedmetadata'))
    expect(el.currentTime).toBe(100)
  })

  it('播满 clipSeconds 秒通知换片（只一次）', () => {
    tile.show(clip, true)
    const el = video()!
    setDuration(el, 1000)
    el.dispatchEvent(new Event('loadedmetadata'))
    el.currentTime = 105
    el.dispatchEvent(new Event('timeupdate'))
    expect(cb.onDone).not.toHaveBeenCalled()
    el.currentTime = 106
    el.dispatchEvent(new Event('timeupdate'))
    el.dispatchEvent(new Event('timeupdate'))
    expect(cb.onDone).toHaveBeenCalledTimes(1)
  })

  it('整段播完（ended）也换片', () => {
    tile.show({ kind: 'video', url: 'short.mp4' }, true)
    video()!.dispatchEvent(new Event('ended'))
    expect(cb.onDone).toHaveBeenCalledTimes(1)
  })

  it('解码失败：报告、清掉 video、退回轮播图片，停留后换片', () => {
    tile.show(clip, true)
    video()!.dispatchEvent(new Event('error'))
    expect(cb.onFailed).toHaveBeenCalledTimes(1)
    expect(video()).toBeNull()
    expect(calls).toContain('load:')
    expect(image()?.getAttribute('src')).toBe('a.jpg')
    vi.advanceTimersByTime(6000)
    expect(cb.onDone).toHaveBeenCalledTimes(1)
  })

  it('卡住（waiting）超过 stallMs 没恢复：报告降级', () => {
    tile.show(clip, true)
    const el = video()!
    el.dispatchEvent(new Event('waiting'))
    vi.advanceTimersByTime(2000)
    el.dispatchEvent(new Event('playing'))
    vi.advanceTimersByTime(5000)
    expect(cb.onStrain).not.toHaveBeenCalled()
    el.dispatchEvent(new Event('waiting'))
    vi.advanceTimersByTime(3000)
    expect(cb.onStrain).toHaveBeenCalledTimes(1)
  })

  it('掉帧判定：两次采样之间掉帧超过四分之一才算吃力', () => {
    const q = (total: number, dropped: number): FrameQuality => ({
      totalVideoFrames: total,
      droppedVideoFrames: dropped,
    })
    expect(isStrained(q(0, 0), q(60, 5))).toBe(false)
    expect(isStrained(q(0, 0), q(60, 20))).toBe(true)
    // 帧太少不下结论
    expect(isStrained(q(0, 0), q(10, 9))).toBe(false)
  })
})

describe('只放图的格', () => {
  it('不占播放名额的视频格：轮播备用图，不建 video', () => {
    tile.show(clip, false)
    expect(video()).toBeNull()
    expect(image()?.getAttribute('src')).toBe('a.jpg')
    vi.advanceTimersByTime(3000)
    expect(image()?.getAttribute('src')).toBe('b.jpg')
    vi.advanceTimersByTime(3000)
    expect(cb.onDone).toHaveBeenCalledTimes(1)
  })

  it('网盘条目（只有缓存图）：轮播', () => {
    tile.show({ kind: 'images', urls: ['x.jpg'] }, true)
    expect(video()).toBeNull()
    expect(image()?.getAttribute('src')).toBe('x.jpg')
  })

  it('什么都没有：保持海报，停留后换片', () => {
    tile.show(null, true)
    expect(host.children).toHaveLength(0)
    vi.advanceTimersByTime(6000)
    expect(cb.onDone).toHaveBeenCalledTimes(1)
  })
})

describe('暂停 / 继续 / 换片 / 释放', () => {
  it('暂停时视频停、停留计时也停；继续后接着算', () => {
    tile.show(clip, false)
    vi.advanceTimersByTime(4000)
    tile.pause()
    vi.advanceTimersByTime(60_000)
    expect(cb.onDone).not.toHaveBeenCalled()
    tile.resume()
    vi.advanceTimersByTime(2000)
    expect(cb.onDone).toHaveBeenCalledTimes(1)
  })

  it('暂停视频格：pause()；继续：play()', () => {
    tile.show(clip, true)
    calls.length = 0
    tile.pause()
    expect(calls).toEqual(['pause'])
    tile.resume()
    expect(calls).toEqual(['pause', 'play:local://movie.mp4'])
  })

  it('换片：旧 video 先清 src + load() 再放新的', () => {
    tile.show(clip, true)
    const first = video()!
    tile.show({ ...clip, url: 'local://next.mp4' }, true)
    expect(first.hasAttribute('src')).toBe(false)
    expect(calls).toContain('load:')
    expect(video()?.getAttribute('src')).toBe('local://next.mp4')
    expect(host.querySelectorAll('video')).toHaveLength(1)
  })

  it('释放：暂停、去掉 src、load()、移出格子，之后的事件不再回调', () => {
    tile.show(clip, true)
    const el = video()!
    tile.release()
    expect(calls.slice(-2)).toEqual(['pause', 'load:'])
    expect(el.hasAttribute('src')).toBe(false)
    expect(el.isConnected).toBe(false)
    el.dispatchEvent(new Event('ended'))
    el.dispatchEvent(new Event('error'))
    vi.advanceTimersByTime(60_000)
    expect(cb.onDone).not.toHaveBeenCalled()
    expect(cb.onFailed).not.toHaveBeenCalled()
  })
})
