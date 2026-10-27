import { describe, expect, it } from 'vitest'

import {
  addedLabel,
  qualityBadge,
} from '../../src/renderer/src/features/library/home/recent-rules'

/** 首页「刚入库」：入库时间的说法与画质角标 */

const day = (d: number, h = 12): number => new Date(2026, 9, d, h).getTime()

describe('addedLabel', () => {
  const now = day(27, 14) // 2026-10-27 周二

  it('今天 / 昨天 / 一周内写星期 / 再早写日期，跨年加年份', () => {
    expect(addedLabel(day(27, 0), now)).toBe('今天')
    expect(addedLabel(day(26, 23), now)).toBe('昨天')
    expect(addedLabel(day(26, 0), now)).toBe('昨天')
    expect(addedLabel(day(25), now)).toBe('周日')
    expect(addedLabel(day(21), now)).toBe('周三')
    expect(addedLabel(day(20), now)).toBe('10月20日')
    expect(addedLabel(new Date(2025, 11, 31).getTime(), now)).toBe(
      '2025年12月31日'
    )
  })

  it('时间比现在晚（时钟偏差）也算今天', () => {
    expect(addedLabel(day(28), now)).toBe('今天')
  })
})

describe('qualityBadge', () => {
  it('文件名里的 4K / 1080P 优先（只看文件名，不看目录）', () => {
    expect(qualityBadge(['/m/Dune.Part.Two.2024.2160p.DV.mkv'])).toEqual({
      variant: 'solid',
      text: '4K',
    })
    expect(qualityBadge(['D:\\4K电影\\Dune.1080p.mkv'])).toEqual({
      variant: 'outline',
      text: '1080P',
    })
  })

  it('文件名没写分辨率时用探测到的动态范围；都没有为 null', () => {
    expect(qualityBadge(['/m/dune.mkv'], 'dv')).toEqual({
      variant: 'dolby',
      text: 'VISION',
    })
    expect(qualityBadge(['/m/dune.mkv'], 'hdr10')?.text).toBe('HDR')
    expect(qualityBadge(['/m/dune.mkv'], 'sdr')).toBeNull()
    expect(qualityBadge([])).toBeNull()
  })
})
