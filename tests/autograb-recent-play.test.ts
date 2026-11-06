import { describe, expect, it } from 'vitest'

import { recentPlayOrder } from '../src/renderer/src/features/autograb/autograb-rules'
import type { AutograbSeries } from '../src/shared/contract/autograb'

const series = (seriesId: number, title: string): AutograbSeries =>
  ({ seriesId, title }) as AutograbSeries

describe('在追的剧按最近播放排', () => {
  const list = [
    series(1, '甲'),
    series(2, '乙 剧'),
    series(3, '丙'),
    series(4, '丁'),
  ]

  it('播放过的按最近一次播放由近到远排前面，没播放过的保持原顺序', () => {
    const records = [
      { title: '乙剧', updatedAt: 100 },
      { title: '丁', updatedAt: 300 },
      { title: '丁', updatedAt: 200 },
    ]

    expect(recentPlayOrder(list, records).map(s => s.seriesId)).toEqual([
      4, 2, 1, 3,
    ])
  })

  it('没有任何播放记录时顺序不变', () => {
    expect(recentPlayOrder(list, []).map(s => s.seriesId)).toEqual([1, 2, 3, 4])
  })
})
