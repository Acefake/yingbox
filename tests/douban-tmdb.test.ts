import { describe, expect, it, vi } from 'vitest'

import { enrichFromTmdb } from '@/features/online/utils/douban-tmdb'
import type { DoubanItem } from '@/features/online/types'

/**
 * 豆瓣卡用 TMDB 补海报 / 年份 / 简介（浏览页、首页货架追加的每一页都要补）。
 * 没配 TMDB 令牌时整批停下，但要退回豆瓣自己的封面（以前整批停下时封面留空，只显示占位图）。
 */

const item = (title: string): DoubanItem => ({
  title,
  searchTitle: title,
  original_title: '',
  cover: '',
  coverSrc: `https://img1.doubanio.com/${title}.jpg`,
  rate: '8.0',
  url: 'https://movie.douban.com/subject/1/',
  year: '',
  type: '',
  overview: '',
  kind: 'movie',
})

describe('TMDB 补全', () => {
  it('没有令牌：只问一次，所有卡退回豆瓣封面', async () => {
    const tmdb = vi.fn(async () => null)
    const items = [item('a'), item('b'), item('c'), item('d'), item('e')]
    await enrichFromTmdb(items, 'movie', tmdb)
    expect(items.map(i => i.cover)).toEqual(items.map(i => i.coverSrc))
    expect(tmdb.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('找到条目：TMDB 海报、年份、类型、简介、原名、搜源片名', async () => {
    const tmdb = vi.fn(async () => ({
      results: [
        {
          poster_path: '/p.jpg',
          backdrop_path: '/scene.jpg',
          release_date: '2023-01-22',
          overview: '太阳即将毁灭',
          original_title: 'The Wandering Earth II',
          title: '流浪地球2',
          vote_average: 7.4,
        },
      ],
    }))
    const items = [item('流浪地球2')]
    await enrichFromTmdb(items, 'movie', tmdb)
    expect(items[0]).toMatchObject({
      cover: 'https://images.tmdb.org/t/p/w342/p.jpg',
      backdrop: 'https://images.tmdb.org/t/p/w1280/scene.jpg',
      year: '2023',
      type: '电影',
      overview: '太阳即将毁灭',
      original_title: 'The Wandering Earth II',
      searchTitle: '流浪地球2',
      tmdbRate: 7.4,
    })
    expect(tmdb).toHaveBeenCalledWith('/search/movie', {
      query: '流浪地球2',
      page: 1,
    })
  })

  it('请求出错的条目退回豆瓣封面，其余照常', async () => {
    const tmdb = vi.fn(
      async (_p: string, q: Record<string, string | number>) => {
        if (q.query === 'bad') throw new Error('timeout')
        return { results: [] }
      }
    )
    const items = [item('bad')]
    await enrichFromTmdb(items, 'tv', tmdb)
    expect(items[0].cover).toBe(items[0].coverSrc)
  })
})
