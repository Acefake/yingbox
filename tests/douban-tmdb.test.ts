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
  it('原名不带季号且年份未知时也必须查询本季', async () => {
    const season = {
      ...item('剧名 第二季'),
      kind: 'tv' as const,
      original_title: 'Show',
    }
    const search = vi.fn(async (path: string) =>
      path === '/tv/10/season/2'
        ? {
            season_number: 2,
            air_date: '2024-05-01',
            poster_path: '/season2.jpg',
          }
        : {
            results: [
              {
                id: 10,
                name: '剧名',
                original_name: 'Show',
                first_air_date: '2019-01-01',
              },
            ],
          }
    )
    await enrichFromTmdb([season], 'tv', search)
    expect(search).toHaveBeenCalledWith('/tv/10/season/2', {})
    expect(season.year).toBe('2024')
    expect(season.searchTitle).toBe(season.title)
  })
  it('单独建档且名称年份精确匹配的季条目照常补全', async () => {
    const season = { ...item('剧名 第二季'), kind: 'tv' as const, year: '2024' }
    const search = vi.fn(async () => ({
      results: [
        {
          id: 10,
          name: season.title,
          first_air_date: '2024-01-01',
          poster_path: '/season.jpg',
        },
      ],
    }))
    await enrichFromTmdb([season], 'tv', search)
    expect(season.cover).toContain('/season.jpg')
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('找不到对应季时不拿整部剧的资料覆盖本季', async () => {
    const season = { ...item('剧名 第二季'), kind: 'tv' as const, year: '2024' }
    await enrichFromTmdb([season], 'tv', async path =>
      path.startsWith('/tv/')
        ? {
            season_number: 1,
            air_date: '2024-01-01',
            poster_path: '/wrong.jpg',
          }
        : { results: [{ id: 10, name: '剧名', first_air_date: '2019-01-01' }] }
    )
    expect(season.cover).toBe(season.coverSrc)
    expect(season.searchTitle).toBe(season.title)
  })
  it.each(['剧名 第二季', '剧名 Season 2', '剧名 S02'])(
    '%s 用总剧定位分季，保持本季年份和搜源片名',
    async title => {
      const season = {
        ...item(title),
        kind: 'tv' as const,
        year: '2024',
        original_title: 'Show Season 2',
      }
      const search = vi.fn(async (path: string) =>
        path === '/tv/10/season/2'
          ? {
              season_number: 2,
              air_date: '2024-05-01',
              poster_path: '/season2.jpg',
              overview: '第二季简介',
              vote_average: 8,
            }
          : {
              results: [
                {
                  id: 10,
                  name: '剧名',
                  original_name: 'Show',
                  first_air_date: '2019-01-01',
                  poster_path: '/series.jpg',
                },
              ],
            }
      )
      await enrichFromTmdb([season], 'tv', search)
      expect(season.cover).toContain('/season2.jpg')
      expect(season.year).toBe('2024')
      expect(season.searchTitle).toBe(title)
      expect(season.original_title).toBe('Show Season 2')
      expect(season.overview).toBe('第二季简介')
    }
  )

  it('分季首播年份不符时仍保留豆瓣封面', async () => {
    const season = { ...item('剧名 第二季'), kind: 'tv' as const, year: '2024' }
    await enrichFromTmdb([season], 'tv', async path =>
      path.startsWith('/tv/')
        ? {
            season_number: 2,
            air_date: '2010-01-01',
            poster_path: '/wrong.jpg',
          }
        : { results: [{ id: 10, name: '剧名', first_air_date: '2008-01-01' }] }
    )
    expect(season.cover).toBe(season.coverSrc)
    expect(season.year).toBe('2024')
  })

  it('总剧匹配有歧义时不通过查分季绕过歧义', async () => {
    const season = { ...item('剧名 第二季'), kind: 'tv' as const, year: '2024' }
    const search = vi.fn(async () => ({
      results: [
        { id: 10, name: '剧名' },
        { id: 11, name: '剧名' },
      ],
    }))
    await enrichFromTmdb([season], 'tv', search)
    expect(season.cover).toBe(season.coverSrc)
    expect(search).toHaveBeenCalledTimes(1)
  })
  it('已发现同名歧义时不被 multi 的单条结果覆盖', async () => {
    const movie = item('同名电影')
    const hit = { id: 1, title: movie.title, poster_path: '/wrong.jpg' }
    const tmdb = vi.fn(async (path: string) => ({
      results: path === '/search/multi' ? [hit] : [hit, { ...hit, id: 2 }],
    }))
    await enrichFromTmdb([movie], 'movie', tmdb)
    expect(movie.cover).toBe(movie.coverSrc)
  })
  it('同名翻拍按年份选候选，不能直接采用第一条', async () => {
    const movie = { ...item('同名电影'), year: '2020' }
    await enrichFromTmdb([movie], 'movie', async () => ({
      results: [
        {
          id: 1,
          title: movie.title,
          release_date: '1990-01-01',
          poster_path: '/wrong.jpg',
        },
        {
          id: 2,
          title: movie.title,
          release_date: '2020-01-01',
          poster_path: '/right.jpg',
        },
      ],
    }))
    expect(movie.cover).toContain('/right.jpg')
    expect(movie.year).toBe('2020')
  })

  it.each(['年份冲突', '类型冲突', '同名歧义'])(
    '%s 时保留豆瓣数据',
    async reason => {
      const movie = {
        ...item('同名电影'),
        year: reason === '同名歧义' ? '' : '2020',
        overview: '豆瓣简介',
      }
      const hit = {
        id: 1,
        title: movie.title,
        release_date: '2020-01-01',
        poster_path: '/wrong.jpg',
      }
      const results =
        reason === '年份冲突'
          ? [{ ...hit, release_date: '1990-01-01' }]
          : reason === '类型冲突'
            ? [{ ...hit, media_type: 'tv' }]
            : [hit, { ...hit, id: 2, release_date: '1990-01-01' }]
      await enrichFromTmdb([movie], 'movie', async () => ({ results }))
      expect(movie.cover).toBe(movie.coverSrc)
      expect(movie.overview).toBe('豆瓣简介')
      expect(movie.year).toBe(reason === '同名歧义' ? '' : '2020')
    }
  )
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
