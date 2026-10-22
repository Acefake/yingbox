import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  BROWSE_TTL_MS,
  buildDoubanRequest,
  createDoubanBrowse,
  parseRecommend,
  parseSearchSubjects,
} from '../src/engine/online/douban-browse'
import { createOnlineHandlers } from '../src/engine/online'
import { online } from '../src/shared/contract/online'
import {
  type DoubanQuery,
  defaultDoubanQuery,
  normalizeDoubanQuery,
} from '../src/shared/douban/query'
import type { NetClient } from '../src/shared/net/client'
import { HttpStatusError } from '../src/shared/net/client'
import { HostUnavailableError } from '../src/shared/net/host-breaker'

/**
 * 豆瓣多维浏览（引擎）：快捷标签走 movie.douban.com/j/search_subjects，多维筛选走
 * m.douban.com/rexxar/api/v2/<movie|tv>/recommend；参数白名单、结果映射成统一卡片、缓存、熔断。
 * 沙箱在海外、豆瓣会 302 到验证页，这里全部用假网络 + 按真实接口结构手写的夹具（tests/fixtures/douban）。
 */

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/douban/${name}.json`, 'utf8'))

const query = (patch: Partial<DoubanQuery> = {}): DoubanQuery =>
  normalizeDoubanQuery({ ...defaultDoubanQuery(), ...patch })

interface Request {
  url: string
  headers: Record<string, string>
}

/** 假网络：按地址前缀回复（可以是函数），记录每次请求 */
function fakeNet(routes: Record<string, unknown>): NetClient & {
  requests: Request[]
} {
  const requests: Request[] = []
  return {
    requests,
    open: () => Promise.reject(new Error('unused')),
    request: () => Promise.reject(new Error('unused')),
    getText: () => Promise.reject(new Error('unused')),
    async getJson<T>(url: string, req?: { headers?: Record<string, string> }) {
      requests.push({ url, headers: req?.headers ?? {} })
      const key = Object.keys(routes).find(prefix => url.startsWith(prefix))
      if (!key) throw new HttpStatusError(404)
      const r = routes[key]
      const value = typeof r === 'function' ? (r as () => unknown)() : r
      if (value instanceof Error) throw value
      return value as T
    },
  }
}

const SEARCH = 'https://movie.douban.com/j/search_subjects'
const MOVIE_RECOMMEND = 'https://m.douban.com/rexxar/api/v2/movie/recommend'
const TV_RECOMMEND = 'https://m.douban.com/rexxar/api/v2/tv/recommend'

describe('拼请求', () => {
  it('没动筛选：快捷标签接口，type / tag / 20 条一页 / page_start', () => {
    const { url, headers } = buildDoubanRequest(
      query({ kind: 'tv', tag: '美剧' }),
      40
    )
    const u = new URL(url)
    expect(`${u.origin}${u.pathname}`).toBe(SEARCH)
    expect(Object.fromEntries(u.searchParams)).toEqual({
      type: 'tv',
      tag: '美剧',
      sort: 'recommend',
      page_limit: '20',
      page_start: '40',
    })
    expect(headers.Referer).toBe('https://movie.douban.com/')
  })

  it('动了筛选：rexxar 探索接口，类型 / 地区 / 年代进 tags，评分下限进 score_range，排序进 sort', () => {
    const { url, headers } = buildDoubanRequest(
      query({
        genre: '喜剧',
        region: '华语',
        era: '2010年代',
        sort: 'S',
        minRating: 7,
      }),
      20
    )
    const u = new URL(url)
    expect(`${u.origin}${u.pathname}`).toBe(MOVIE_RECOMMEND)
    expect(u.searchParams.get('start')).toBe('20')
    expect(u.searchParams.get('count')).toBe('20')
    expect(u.searchParams.get('tags')).toBe('喜剧,华语,2010年代')
    expect(JSON.parse(u.searchParams.get('selected_categories')!)).toEqual({
      类型: '喜剧',
      地区: '华语',
    })
    expect(u.searchParams.get('score_range')).toBe('7,10')
    expect(u.searchParams.get('sort')).toBe('S')
    expect(u.searchParams.get('uncollect')).toBe('false')
    expect(headers.Referer).toBe('https://movie.douban.com/explore')
  })

  it('电视剧走 /tv/recommend；只改排序也算筛选；没选的维度不出现在 tags', () => {
    const { url } = buildDoubanRequest(query({ kind: 'tv', sort: 'T' }), 0)
    const u = new URL(url)
    expect(`${u.origin}${u.pathname}`).toBe(TV_RECOMMEND)
    expect(u.searchParams.get('tags')).toBe('')
    expect(u.searchParams.get('sort')).toBe('T')
    expect(u.searchParams.get('score_range')).toBe('0,10')
  })

  it('白名单：不认识的值丢成默认，拼不进地址', () => {
    const q = normalizeDoubanQuery({
      kind: 'movie',
      tag: '热门&tag=x',
      genre: '喜剧,情色',
      region: '火星',
      era: '2010年代"}',
      sort: 'Z',
      minRating: 6.5,
      extra: 'https://evil.test/',
    })
    expect(q).toEqual(defaultDoubanQuery('movie'))
    // 类型按各自的白名单收：「纪录片」只在电影里，「古装」只在电视剧里
    expect(normalizeDoubanQuery({ kind: 'tv', genre: '纪录片' }).genre).toBe('')
    expect(normalizeDoubanQuery({ kind: 'tv', genre: '古装' }).genre).toBe(
      '古装'
    )
    // 动了筛选时快捷标签清空，否则回到「热门」
    expect(normalizeDoubanQuery({ tag: '华语', genre: '喜剧' }).tag).toBe('')
    expect(normalizeDoubanQuery({ tag: '' }).tag).toBe('热门')
    expect(normalizeDoubanQuery({ era: '2025' }).era).toBe('2025')
    expect(normalizeDoubanQuery({ era: '1850' }).era).toBe('')
  })
})

describe('映射成卡片', () => {
  it('rexxar：只要 movie / tv 条目，评分一位小数，年份取 year 或副标题，地址规范化；下一页按 total 判断', () => {
    const page = parseRecommend(fixture('recommend-movie'), 'movie', 0, 0)
    expect(page.items).toEqual([
      {
        id: '35267208',
        title: '流浪地球2',
        cover:
          'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2885955777.jpg',
        rate: '8.3',
        url: 'https://movie.douban.com/subject/35267208/',
        year: '2023',
        kind: 'movie',
      },
      {
        id: '1292052',
        title: '肖申克的救赎',
        cover:
          'https://img2.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg',
        rate: '9.7',
        url: 'https://movie.douban.com/subject/1292052/',
        year: '1994',
        kind: 'movie',
      },
      {
        id: '3000001',
        title: '暂无评分的片',
        cover:
          'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg',
        rate: '',
        url: 'https://movie.douban.com/subject/3000001/',
        year: '2026',
        kind: 'movie',
      },
    ])
    expect(page.next).toBe(20)
    // 到 total 就没有下一页；空列表也没有
    expect(
      parseRecommend(
        { total: 22, items: [{ id: '1', title: 'a' }] },
        'tv',
        20,
        0
      ).next
    ).toBeNull()
    expect(parseRecommend({ items: [] }, 'movie', 0, 0).next).toBeNull()
  })

  it('rexxar：评分下限在本地再筛一遍（接口不认 score_range 时也对）', () => {
    const page = parseRecommend(fixture('recommend-movie'), 'movie', 0, 9)
    expect(page.items.map(i => i.id)).toEqual(['1292052'])
    expect(page.next).toBe(20)
  })

  it('快捷标签接口：subjects 映射，空评分为空串；满 20 条才有下一页', () => {
    const page = parseSearchSubjects(fixture('search-subjects'), 'movie', 0)
    expect(page.items[0]).toEqual({
      id: '35267208',
      title: '流浪地球2',
      cover:
        'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2885955777.jpg',
      rate: '8.3',
      url: 'https://movie.douban.com/subject/35267208/',
      year: '',
      kind: 'movie',
    })
    expect(page.items[1].rate).toBe('')
    expect(page.next).toBeNull()
    const full = {
      subjects: Array.from({ length: 20 }, (_, i) => ({
        id: String(100 + i),
        title: `t${i}`,
        cover: '',
        rate: '7.0',
        url: `https://movie.douban.com/subject/${100 + i}/`,
      })),
    }
    expect(parseSearchSubjects(full, 'tv', 980).next).toBe(1000)
    // 到上限不再翻
    expect(parseSearchSubjects(full, 'tv', 1000).next).toBeNull()
  })

  it('不是接口数据（验证页、错误 JSON）抛错，ID 不是数字的条目丢掉', () => {
    expect(() => parseRecommend({ msg: 'need_login' }, 'movie', 0, 0)).toThrow()
    expect(() => parseSearchSubjects('<html>', 'movie', 0)).toThrow()
    expect(
      parseSearchSubjects(
        { subjects: [{ id: 'x/../1', title: 'a', url: 'https://evil.test/' }] },
        'movie',
        0
      ).items
    ).toEqual([])
  })
})

describe('取一页', () => {
  it('同一页 10 分钟内只请求一次（并发也只一次），过期再请求', async () => {
    let t = 0
    const net = fakeNet({ [MOVIE_RECOMMEND]: fixture('recommend-movie') })
    const browse = createDoubanBrowse({ net, now: () => t })
    const q = query({ genre: '喜剧' })
    const [a, b] = await Promise.all([browse.page(q, 0), browse.page(q, 0)])
    expect(a).toEqual(b)
    expect(await browse.page(q, 0)).toEqual(a)
    expect(net.requests).toHaveLength(1)
    t = BROWSE_TTL_MS + 1
    await browse.page(q, 0)
    expect(net.requests).toHaveLength(2)
  })

  it('失败不缓存；连续 3 次失败熔断，冷却期内不发请求直接报不可用', async () => {
    let t = 0
    let fail = true
    const net = fakeNet({
      [SEARCH]: () =>
        fail ? new HttpStatusError(403) : fixture('search-subjects'),
    })
    const browse = createDoubanBrowse({ net, now: () => t })
    const q = query()
    for (let i = 0; i < 3; i++)
      await expect(browse.page(q, 0)).rejects.toThrow()
    expect(net.requests).toHaveLength(3)
    await expect(browse.page(q, 0)).rejects.toBeInstanceOf(HostUnavailableError)
    expect(net.requests).toHaveLength(3)
    // 冷却 10 分钟后恢复
    fail = false
    t = 10 * 60 * 1000 + 1
    expect((await browse.page(q, 0)).items).toHaveLength(2)
  })

  it('302 到验证页（拿到的不是接口数据）算失败、不缓存', async () => {
    let calls = 0
    const net = fakeNet({
      [MOVIE_RECOMMEND]: () =>
        ++calls === 1 ? { msg: 'sec.douban.com' } : fixture('recommend-movie'),
    })
    const browse = createDoubanBrowse({ net })
    const q = query({ sort: 'R' })
    await expect(browse.page(q, 0)).rejects.toThrow()
    expect((await browse.page(q, 0)).items).toHaveLength(3)
  })
})

describe('契约与接线', () => {
  const parse = online.calls.doubanBrowse.parse

  it('契约：条件按白名单收，start 必须是 0–1000 的整数', () => {
    expect(parse([{ kind: 'tv', tag: '美剧', junk: 1 }, 20])).toEqual([
      { ...defaultDoubanQuery('tv'), tag: '美剧' },
      20,
    ])
    expect(() => parse([{}, -1])).toThrow()
    expect(() => parse([{}, 1.5])).toThrow()
    expect(() => parse([{}, 1001])).toThrow()
    expect(() => parse([{}, '0'])).toThrow()
  })

  it('在线域 handler 把条件交给引擎里的豆瓣浏览', async () => {
    const net = fakeNet({ [SEARCH]: fixture('search-subjects') })
    const handlers = createOnlineHandlers({
      net,
      loadPlugin: () => Promise.reject(new Error('unused')),
    })
    const page = await handlers.doubanBrowse(
      {} as never,
      defaultDoubanQuery('movie'),
      40
    )
    expect(page.items.map(i => i.title)).toEqual(['流浪地球2', '新片未开分'])
    expect(net.requests[0].url).toContain('tag=%E7%83%AD%E9%97%A8')
    expect(net.requests[0].url).toContain('page_start=40')
  })
})
