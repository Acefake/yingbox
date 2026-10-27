import { describe, expect, it } from 'vitest'

import { pickChart } from '../../src/renderer/src/features/online/utils/home-chart'
import type { DoubanSubject } from '../../src/shared/douban/query'

/** 首页榜单行：口碑榜优先，取不到退回热门前 10，标题跟着来源走 */

const subject = (id: number): DoubanSubject => ({
  id: String(id),
  title: `片 ${id}`,
  cover: `https://img/${id}.jpg`,
  rate: '8.0',
  url: `https://movie.douban.com/subject/${id}/`,
  year: '2025',
  kind: 'movie',
})
const list = (n: number, from = 1): DoubanSubject[] =>
  Array.from({ length: n }, (_, i) => subject(from + i))

describe('pickChart', () => {
  it('口碑榜有条目就用口碑榜（最多 10 部，保持名次）', () => {
    const chart = pickChart(list(12), list(20, 100))
    expect(chart?.source).toBe('weekly')
    expect(chart?.title).toBe('豆瓣本周口碑榜')
    expect(chart?.items.map(s => s.id)).toEqual(list(10).map(s => s.id))
  })

  it('口碑榜失败（null）或为空时退回热门前 10，标题不叫口碑榜', () => {
    for (const weekly of [null, []]) {
      const chart = pickChart(weekly, list(20, 100))
      expect(chart?.source).toBe('hot')
      expect(chart?.title).toBe('豆瓣热门 Top 10')
      expect(chart?.items).toHaveLength(10)
      expect(chart?.items[0].id).toBe('100')
    }
  })

  it('同一条目只留一次；两路都没有时为 null（整行隐藏）', () => {
    const dup = [subject(1), subject(1), subject(2)]
    expect(pickChart(dup, null)?.items.map(s => s.id)).toEqual(['1', '2'])
    expect(pickChart(null, null)).toBeNull()
    expect(pickChart([], [])).toBeNull()
  })
})
