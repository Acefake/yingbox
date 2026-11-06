import { describe, expect, it } from 'vitest'

import { pickRatingBadge, ratingLabelProps } from '@/components/ui/rating-badge'

describe('评分角标', () => {
  it('统一来源文字评分，不给未知来源套品牌', () => {
    expect(ratingLabelProps('豆瓣 8.6')).toEqual({ douban: 8.6 })
    expect(ratingLabelProps('TMDB 7.5')).toEqual({ tmdb: 7.5 })
    expect(ratingLabelProps('IMDb 8.2')).toEqual({ other: 'IMDb 8.2' })
    expect(ratingLabelProps(8.2)).toEqual({ other: '8.2' })
    expect(ratingLabelProps('暂无')).toEqual({})
    expect(ratingLabelProps(0)).toEqual({})
  })
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
