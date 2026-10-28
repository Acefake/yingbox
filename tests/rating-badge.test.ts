import { describe, expect, it } from 'vitest'

import { pickRatingBadge } from '@/components/ui/rating-badge'

describe('评分角标', () => {
  it('两个来源都有时用豆瓣', () => {
    expect(pickRatingBadge('8.2', 7.4)).toEqual({
      source: 'douban',
      score: '8.2',
    })
  })

  it('豆瓣没有分数时用 TMDB', () => {
    expect(pickRatingBadge('暂无', 7.4)).toEqual({
      source: 'tmdb',
      score: '7.4',
    })
    expect(pickRatingBadge('', 7)).toEqual({ source: 'tmdb', score: '7.0' })
  })

  it('都没有时不显示', () => {
    expect(pickRatingBadge('暂无', 0)).toBeNull()
    expect(pickRatingBadge(undefined, null)).toBeNull()
  })
})
