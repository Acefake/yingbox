import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MAX_LIVE,
  WALL_LIVE_CHOICES,
  canPlay,
  createWallSchedule,
  wallColumns,
} from '../src/renderer/src/features/library/video-wall/wall-schedule'

/**
 * 视频墙格位调度（纯逻辑）：几列、每格放哪部、哪几格真放视频（同时播放上限 + 选中格优先 +
 * 解码失败的只放图）、播完换下一部（不换成屏上已有的）、按性能降级、什么时候全部暂停。
 */

const ids = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1)
const onScreen = (s: ReturnType<typeof createWallSchedule>): number[] =>
  Array.from({ length: s.cells }, (_, slot) => s.itemAt(slot))

describe('wallColumns：自适应 2×2 / 3×3', () => {
  const wide = { width: 1920, height: 1080 }
  it('影片不超过 4 部用 2×2', () => {
    expect(wallColumns(1, wide)).toBe(2)
    expect(wallColumns(4, wide)).toBe(2)
  })
  it('多于 4 部、屏幕够大用 3×3', () => {
    expect(wallColumns(5, wide)).toBe(3)
    expect(wallColumns(200, wide)).toBe(3)
  })
  it('窗口窄或矮时退到 2×2', () => {
    expect(wallColumns(50, { width: 800, height: 1000 })).toBe(2)
    expect(wallColumns(50, { width: 1600, height: 500 })).toBe(2)
  })
})

describe('createWallSchedule：格位', () => {
  it('格数 = 列² 与影片数取小；按顺序放', () => {
    const s = createWallSchedule(ids(20), 9, 4)
    expect(s.cells).toBe(9)
    expect(onScreen(s)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(createWallSchedule(ids(3), 4, 4).cells).toBe(3)
  })

  it('同时播放上限：只有前 maxLive 格真放视频', () => {
    const s = createWallSchedule(ids(20), 9, 4)
    expect(s.liveSlots()).toEqual([0, 1, 2, 3])
    expect(s.isLive(3)).toBe(true)
    expect(s.isLive(4)).toBe(false)
  })

  it('默认上限 4，可选 1 / 2 / 4 / 6 / 9', () => {
    expect(DEFAULT_MAX_LIVE).toBe(4)
    expect([...WALL_LIVE_CHOICES]).toEqual([1, 2, 4, 6, 9])
  })

  it('选中格优先占一个播放名额', () => {
    const s = createWallSchedule(ids(20), 9, 2)
    s.select(7)
    expect(s.selected()).toBe(7)
    expect(s.liveSlots()).toEqual([0, 7])
  })

  it('选格越界时夹到格内', () => {
    const s = createWallSchedule(ids(20), 9, 2)
    s.select(42)
    expect(s.selected()).toBe(8)
    s.select(-3)
    expect(s.selected()).toBe(0)
  })

  it('改上限立即生效', () => {
    const s = createWallSchedule(ids(20), 9, 4)
    s.setMaxLive(6)
    expect(s.liveSlots()).toHaveLength(6)
    s.setMaxLive(1)
    expect(s.liveSlots()).toEqual([0])
  })

  it('解码失败的影片只放图，名额让给后面的格', () => {
    const s = createWallSchedule(ids(20), 9, 2)
    s.markStatic(1)
    expect(s.liveSlots()).toEqual([1, 2])
    expect(s.isLive(0)).toBe(false)
  })
})

describe('createWallSchedule：换片', () => {
  it('播完换下一部：取队列里下一部，不换成屏上已有的', () => {
    const s = createWallSchedule(ids(12), 4, 4)
    expect(s.advance(0)).toBe(5)
    expect(s.advance(1)).toBe(6)
    expect(onScreen(s)).toEqual([5, 6, 3, 4])
    // 连续换第 3 格：7…12 之后轮回到 1
    for (let i = 0; i < 7; i++) s.advance(2)
    expect(s.itemAt(2)).toBe(1)
    // 再往后 2、3，然后跳过屏上的 4（第 4 格）、5、6（第 1、2 格）直接到 7
    expect([s.advance(2), s.advance(2), s.advance(2)]).toEqual([2, 3, 7])
    expect(new Set(onScreen(s)).size).toBe(4)
  })

  it('影片不多于格数时不换（原地重播），返回 null', () => {
    const s = createWallSchedule(ids(4), 4, 4)
    expect(s.advance(2)).toBeNull()
    expect(onScreen(s)).toEqual([1, 2, 3, 4])
  })

  it('换上来的影片若解码失败过，这格不占播放名额', () => {
    const s = createWallSchedule(ids(6), 4, 4)
    s.markStatic(5)
    expect(s.advance(0)).toBe(5)
    expect(s.isLive(0)).toBe(false)
    expect(s.liveSlots()).toEqual([1, 2, 3])
  })
})

describe('createWallSchedule：按性能降级', () => {
  it('每次降级少一个播放名额，最少 1', () => {
    const s = createWallSchedule(ids(20), 9, 4)
    expect(s.degrade()).toBe(3)
    expect(s.liveSlots()).toHaveLength(3)
    s.degrade()
    s.degrade()
    expect(s.degrade()).toBe(1)
    expect(s.maxLive()).toBe(1)
  })

  it('用户重新设上限时从新上限开始', () => {
    const s = createWallSchedule(ids(20), 9, 4)
    s.degrade()
    s.setMaxLive(6)
    expect(s.maxLive()).toBe(6)
  })
})

describe('设置项 ui.videoWallMaxLive', () => {
  it('默认 4，只接受 1–9', async () => {
    const { defaultValues, parseSetting } =
      await import('../src/shared/settings/schema')
    expect(defaultValues()['ui.videoWallMaxLive']).toBe(DEFAULT_MAX_LIVE)
    expect(parseSetting('ui.videoWallMaxLive', 9)?.value).toBe(9)
    expect(parseSetting('ui.videoWallMaxLive', 0)).toBeUndefined()
    expect(parseSetting('ui.videoWallMaxLive', 12)).toBeUndefined()
  })
})

describe('canPlay：暂停条件', () => {
  const base = { hidden: false, paused: false, reducedMotion: false }
  it('窗口可见、没手动暂停、没开减少动态效果才播', () => {
    expect(canPlay(base)).toBe(true)
    expect(canPlay({ ...base, hidden: true })).toBe(false)
    expect(canPlay({ ...base, paused: true })).toBe(false)
    expect(canPlay({ ...base, reducedMotion: true })).toBe(false)
  })
})
