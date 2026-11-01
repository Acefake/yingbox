/**
 * 首页大图的评分：豆瓣、TMDB 各自一个来源小标；其他来源（IMDb、NFO）退回文字。
 */
import { describe, expect, it } from 'vitest'

import { ratingMarksOf } from '../src/renderer/src/components/ui/rating-badge'

describe('ratingMarksOf', () => {
  it('按来源放进对应的位置', () => {
    expect(ratingMarksOf(6.6, 'tmdb')).toEqual({ douban: null, tmdb: 6.6 })
    expect(ratingMarksOf(8.1, 'douban')).toEqual({ douban: 8.1, tmdb: null })
  })

  it('其他来源、没来源、没有分数两个都为空', () => {
    expect(ratingMarksOf(7, 'imdb')).toEqual({ douban: null, tmdb: null })
    expect(ratingMarksOf(7, null)).toEqual({ douban: null, tmdb: null })
    expect(ratingMarksOf(0, 'tmdb')).toEqual({ douban: null, tmdb: null })
    expect(ratingMarksOf(undefined, 'douban')).toEqual({
      douban: null,
      tmdb: null,
    })
  })
})
