import { describe, expect, it, vi } from 'vitest'

import {
  CLEAR_ALL_PATCH,
  clearFilterPatch,
  filterChips,
  filterPatch,
  filterPills,
} from '../../src/renderer/src/features/online/utils/browse-filters'
import {
  type BrowseTarget,
  COLLECTIONS,
  HOME_GENRES,
  baseQuery,
  browseTitle,
  nextBrowseQuery,
  routeQueryOf,
  targetFromRoute,
} from '../../src/renderer/src/features/online/utils/browse-target'
import {
  type DoubanPage,
  type DoubanQuery,
  GENRES,
  QUICK_TAGS,
  defaultDoubanQuery,
  normalizeDoubanQuery,
} from '../../src/shared/douban/query'

/** 首页下半部：浏览页目标 ↔ 路由 ↔ 豆瓣条件、筛选胶囊 / 已选条件、类型 / 片单预览 */

vi.mock('@/features/online/api/online', () => ({
  doubanBrowse: vi.fn(),
  onlineAvailable: () => true,
  doubanMetadata: vi.fn(async () => null),
  tmdb: vi.fn(() => Promise.resolve(null)),
}))

const q = (patch: Partial<DoubanQuery>): DoubanQuery =>
  normalizeDoubanQuery({ ...defaultDoubanQuery(patch.kind), tag: '', ...patch })

describe('类型与片单的取值', () => {
  it('首页 6 个类型在电影、剧集两边的类型表里都有（切电影 / 剧集不丢类型）', () => {
    expect(HOME_GENRES).toHaveLength(6)
    for (const genre of HOME_GENRES) {
      expect(GENRES.movie).toContain(genre)
      expect(GENRES.tv).toContain(genre)
    }
  })

  it('片单映射到真实的快捷标签：豆瓣高分 / 冷门佳片 / 华语（电影）、韩剧（剧集）', () => {
    expect(COLLECTIONS.map(c => [c.kind, c.tag])).toEqual([
      ['movie', '豆瓣高分'],
      ['movie', '冷门佳片'],
      ['movie', '华语'],
      ['tv', '韩剧'],
    ])
    for (const c of COLLECTIONS) {
      expect(QUICK_TAGS[c.kind]).toContain(c.tag)
      const query = baseQuery({ type: 'list', list: c.id })
      // 经过白名单后仍是快捷标签模式
      expect(normalizeDoubanQuery(query)).toEqual(query)
      expect(query).toMatchObject({ kind: c.kind, tag: c.tag, genre: '' })
    }
  })
})

describe('路由参数', () => {
  const targets: BrowseTarget[] = [
    { type: 'hot', kind: 'movie' },
    { type: 'hot', kind: 'tv' },
    { type: 'genre', genre: '科幻', kind: 'movie' },
    { type: 'genre', genre: '动画', kind: 'tv' },
    { type: 'list', list: 'kdrama' },
  ]
  it('目标 → 参数 → 目标 互逆', () => {
    for (const t of targets) expect(targetFromRoute(routeQueryOf(t))).toEqual(t)
  })

  it('不是浏览页或参数不合法时为 null；kind 缺省为电影', () => {
    expect(targetFromRoute({})).toBeNull()
    expect(targetFromRoute({ tab: 'recent' })).toBeNull()
    expect(targetFromRoute({ browse: 'genre', genre: '不存在' })).toBeNull()
    // 奇幻只在电影类型表里
    expect(
      targetFromRoute({ browse: 'genre', genre: '奇幻', kind: 'tv' })
    ).toBeNull()
    expect(targetFromRoute({ browse: 'list', list: 'x' })).toBeNull()
    expect(targetFromRoute({ browse: 'hot' })).toEqual({
      type: 'hot',
      kind: 'movie',
    })
  })

  it('标题：全部 / 类型名 / 片单名', () => {
    expect(browseTitle({ type: 'hot', kind: 'tv' })).toBe('全部')
    expect(browseTitle({ type: 'genre', genre: '悬疑', kind: 'movie' })).toBe(
      '悬疑'
    )
    expect(browseTitle({ type: 'list', list: 'gems' })).toBe('冷门佳片')
  })
})

describe('nextBrowseQuery', () => {
  const scifi: BrowseTarget = { type: 'genre', genre: '科幻', kind: 'movie' }

  it('从首页进入类型：只选该类型，其余默认', () => {
    expect(nextBrowseQuery(scifi, defaultDoubanQuery('movie'))).toEqual(
      q({ genre: '科幻' })
    )
  })

  it('同一类型再进来（会话里记着筛选）不重取', () => {
    const current = q({ genre: '科幻', region: '欧美', sort: 'S' })
    expect(nextBrowseQuery(scifi, current)).toBeNull()
  })

  it('换到别的类型：从头开始，不带上一个类型的筛选', () => {
    const current = q({ genre: '科幻', region: '欧美' })
    const comedy: BrowseTarget = { type: 'genre', genre: '喜剧', kind: 'movie' }
    expect(nextBrowseQuery(comedy, current, scifi)).toEqual(
      q({ genre: '喜剧' })
    )
  })

  it('同一类型只切电影 / 剧集：保留排序、地区等筛选（剧集没有的值丢掉）', () => {
    const current = q({
      genre: '科幻',
      region: '欧美',
      sort: 'S',
      era: '90年代',
    })
    const tv: BrowseTarget = { ...scifi, kind: 'tv' }
    expect(nextBrowseQuery(tv, current, scifi)).toEqual(
      q({ kind: 'tv', genre: '科幻', region: '欧美', sort: 'S', era: '90年代' })
    )
    const french = q({ genre: '科幻', region: '法国' })
    expect(nextBrowseQuery(tv, french, scifi)).toEqual(
      q({ kind: 'tv', genre: '科幻' })
    )
  })

  it('热门全部：没有类型；带着筛选算合适，带着别的快捷标签或类型要换', () => {
    const hot: BrowseTarget = { type: 'hot', kind: 'movie' }
    expect(nextBrowseQuery(hot, defaultDoubanQuery('movie'))).toBeNull()
    expect(nextBrowseQuery(hot, q({ region: '韩国' }))).toBeNull()
    expect(nextBrowseQuery(hot, q({ genre: '科幻' }))).toEqual(
      defaultDoubanQuery('movie')
    )
    expect(
      nextBrowseQuery(hot, { ...defaultDoubanQuery('movie'), tag: '冷门佳片' })
    ).toEqual(defaultDoubanQuery('movie'))
    // 切到剧集保留评分下限
    expect(
      nextBrowseQuery({ type: 'hot', kind: 'tv' }, q({ minRating: 8 }), hot)
    ).toEqual(q({ kind: 'tv', minRating: 8 }))
  })

  it('片单：换成快捷标签条件；已经是这个片单时不重取', () => {
    const top: BrowseTarget = { type: 'list', list: 'top' }
    const expected = { ...defaultDoubanQuery('movie'), tag: '豆瓣高分' }
    expect(nextBrowseQuery(top, q({ genre: '科幻' }))).toEqual(expected)
    expect(nextBrowseQuery(top, expected)).toBeNull()
  })
})

describe('筛选胶囊与已选条件', () => {
  it('默认：排序写着「综合」，其余只写维度名，都不高亮，没有 chip', () => {
    const pills = filterPills(defaultDoubanQuery('movie'), 2026)
    expect(pills.map(p => p.text)).toEqual([
      '排序 · 综合',
      '地区',
      '年代',
      '评分',
    ])
    expect(pills.some(p => p.active)).toBe(false)
    expect(filterChips(defaultDoubanQuery('movie'))).toEqual([])
  })

  it('选中的值写进胶囊并高亮；chip 按胶囊顺序', () => {
    const query = q({ genre: '科幻', sort: 'S', region: '欧美', minRating: 8 })
    const pills = filterPills(query, 2026)
    expect(pills.map(p => [p.text, p.active])).toEqual([
      ['排序 · 评分', true],
      ['地区 · 欧美', true],
      ['年代', false],
      ['评分 · 8 分以上', true],
    ])
    expect(filterChips(query).map(c => c.label)).toEqual([
      '评分',
      '欧美',
      '8 分以上',
    ])
  })

  it('选项：地区跟着电影 / 剧集，年代从今年开始，评分含「不限」', () => {
    const [, region, era, rating] = filterPills(defaultDoubanQuery('tv'), 2026)
    expect(region.options[0]).toEqual({ value: '', label: '全部' })
    expect(region.options.map(o => o.value)).not.toContain('法国')
    expect(era.options.slice(1, 3).map(o => o.value)).toEqual(['2026', '2025'])
    expect(rating.options[0]).toEqual({ value: '0', label: '不限' })
  })

  it('选值 / 去掉一个 / 清除 → 条件补丁；清除后热门页回到「热门」，类型页保留类型', () => {
    expect(filterPatch('rating', '7')).toEqual({ minRating: 7 })
    expect(filterPatch('sort', 'R')).toEqual({ sort: 'R' })
    expect(filterPatch('era', '2010年代')).toEqual({ era: '2010年代' })
    expect(clearFilterPatch('sort')).toEqual({ sort: 'U' })
    expect(clearFilterPatch('rating')).toEqual({ minRating: 0 })
    expect(clearFilterPatch('region')).toEqual({ region: '' })

    const hot = q({ region: '欧美', era: '2025' })
    expect(normalizeDoubanQuery({ ...hot, ...CLEAR_ALL_PATCH })).toEqual(
      defaultDoubanQuery('movie')
    )
    const genre = q({ genre: '科幻', region: '欧美' })
    expect(normalizeDoubanQuery({ ...genre, ...CLEAR_ALL_PATCH })).toEqual(
      q({ genre: '科幻' })
    )
  })
})

describe('类型 / 片单预览', () => {
  const page: DoubanPage = {
    items: [1, 2, 3, 4].map(id => ({
      id: String(id),
      title: `片${id}`,
      cover: `https://img1.doubanio.com/p${id}.jpg`,
      rate: '8.0',
      url: `https://movie.douban.com/subject/${id}/`,
      year: '2024',
      kind: 'movie' as const,
    })),
    next: 20,
  }

  it('取第一页前 N 部、补全一次；同一条件全窗口共用，取到后不再请求；失败留空可重试', async () => {
    const { useDoubanPreview, resetDoubanPreviews } =
      await import('../../src/renderer/src/features/online/composables/use-home-browse')
    resetDoubanPreviews()
    const browse = vi.fn().mockRejectedValueOnce(new Error('302'))
    const enrich = vi.fn()
    const query = q({ genre: '科幻' })
    const a = useDoubanPreview(query, 3, { browse, enrich })
    await a.load()
    expect(a.items.value).toBeNull()

    browse.mockResolvedValue(page)
    await a.load()
    expect(a.items.value?.map(i => i.title)).toEqual(['片1', '片2', '片3'])
    expect(enrich).toHaveBeenCalledTimes(1)
    expect(browse).toHaveBeenCalledWith(query, 0)

    const b = useDoubanPreview(query, 3, { browse, enrich })
    expect(b.items).toBe(a.items)
    await b.load()
    expect(browse).toHaveBeenCalledTimes(2)
  })
})
