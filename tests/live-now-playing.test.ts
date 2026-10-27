import { describe, expect, it } from 'vitest'

import {
  formatDayLabel,
  nowPlaying,
} from '../src/renderer/src/features/live/utils/epg-rules'
import { qualityLabel } from '../src/renderer/src/features/live/utils/live-rules'

/** 直播页的「当前节目 / 进度 / 剩余分钟」与节目单日期 */
describe('nowPlaying', () => {
  const min = 60_000
  const list = [
    { start: 0, stop: 60 * min, title: '动物世界' },
    { start: 60 * min, stop: 120 * min, title: '自然的力量' },
    { start: 120 * min, stop: 180 * min, title: '航拍中国' },
  ]

  it('算出当前节目、进度、剩余分钟和下一档', () => {
    const r = nowPlaying(list, 89 * min)
    expect(r?.programme.title).toBe('自然的力量')
    expect(r?.progress).toBeCloseTo(29 / 60)
    expect(r?.remainingMinutes).toBe(31)
    expect(r?.next?.title).toBe('航拍中国')
  })

  it('剩余分钟向上取整，最后不足一分钟仍显示 1', () => {
    expect(nowPlaying(list, 89 * min + 30_000)?.remainingMinutes).toBe(31)
    expect(nowPlaying(list, 120 * min - 1)?.remainingMinutes).toBe(1)
  })

  it('开始那一刻进度为 0，最后一档没有下一档', () => {
    const r = nowPlaying(list, 120 * min)
    expect(r?.programme.title).toBe('航拍中国')
    expect(r?.progress).toBe(0)
    expect(r?.next).toBeNull()
  })

  it('没有节目单或不在任何一档里时为 null', () => {
    expect(nowPlaying(undefined, 0)).toBeNull()
    expect(nowPlaying([], 0)).toBeNull()
    expect(nowPlaying(list, 200 * min)).toBeNull()
    expect(nowPlaying(list, -1)).toBeNull()
  })
})

describe('formatDayLabel', () => {
  it('月日加周几（本机时区）', () => {
    expect(formatDayLabel(new Date(2026, 9, 27, 20).getTime())).toBe(
      '10月27日 周二'
    )
    expect(formatDayLabel(new Date(2026, 10, 1, 8).getTime())).toBe(
      '11月1日 周日'
    )
  })
})

describe('qualityLabel', () => {
  it('按画面高度给清晰度', () => {
    expect(qualityLabel(2160)).toBe('4K')
    expect(qualityLabel(1440)).toBe('2K')
    expect(qualityLabel(1080)).toBe('1080P')
    expect(qualityLabel(576)).toBe('576P')
    expect(qualityLabel(0)).toBe('')
    expect(qualityLabel(Number.NaN)).toBe('')
  })
})
