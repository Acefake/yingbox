import { describe, expect, it } from 'vitest'
import { getVodList } from '../src/renderer/src/utils/vod-data'
import {
  MISSAV_SOURCE,
  browseCacheKey,
  buildAvEntries,
  buildFilterRows,
  createBrowseUrl,
  mergeCategories,
  mergePage,
  missavCategoriesFor,
  missavSlug,
  parsePluginTabs,
  rememberBounded,
  sortBrowseVideos,
  toMissavItems,
  toPluginItems,
} from '../src/renderer/src/features/av/utils/av-catalog'
import {
  mergeByTitle,
  needsPluginResolve,
  nextEpisode,
  nextInList,
  parseCmsEpisodes,
  playTitle,
  searchCacheKey,
  toggleFavorite,
  upsertPlayHistory,
} from '../src/renderer/src/features/av/utils/av-playback'
import { mapWithConcurrency } from '../src/renderer/src/utils/concurrency'

describe('AV 浏览规则', () => {
  const entries = buildAvEntries(
    [{ api: 'cms-a', name: 'A' }],
    [{ api: 'csp_jable', name: 'Jable' }]
  )

  it('数据源：MissAV 在最前；筛选栏里插件排在 CMS 前并标「（插件）」', () => {
    expect(entries.map(e => e.kind)).toEqual(['missav', 'cms', 'plugin'])
    const [source] = buildFilterRows(entries, 'cms-a', [])
    expect(source.options.map(o => o.label)).toEqual([
      'MissAV',
      'Jable（插件）',
      'A',
    ])
  })

  it('排序文案：MissAV 用「本月热度 / 总浏览」，其它源用「本周热度 / 评分优先」', () => {
    const labels = (api: string) =>
      buildFilterRows(entries, api, [])[1].options.map(o => o.label)
    expect(labels(MISSAV_SOURCE)).toEqual(['最新更新', '本月热度', '总浏览'])
    expect(labels('cms-a')).toEqual(['最新发布', '本周热度', '评分优先'])
  })

  it('本地排序：热度 / 评分 / 时间倒序；MissAV 保持服务端顺序且不改原数组', () => {
    const videos = [
      { id: 1, vod_hits_week: 5, vod_score: 9, vod_time: '2024-01-01' },
      { id: 2, vod_hits_week: 50, vod_score: 1, vod_time_add: '2025-01-01' },
      { id: 3, vod_hits_week: 0, vod_score: 5, vod_time: '2023-01-01' },
    ]
    const ids = (list: { id: number }[]): number[] => list.map(v => v.id)
    expect(ids(sortBrowseVideos(videos, 'hot', false))).toEqual([2, 1, 3])
    expect(ids(sortBrowseVideos(videos, 'rating', false))).toEqual([1, 3, 2])
    expect(ids(sortBrowseVideos(videos, 'latest', false))).toEqual([2, 1, 3])
    expect(sortBrowseVideos(videos, 'hot', true)).toBe(videos)
    expect(ids(videos)).toEqual([1, 2, 3])
  })

  it('分类合并：新 type_id 并入、已有的不覆盖、无名/非数字跳过、「全部」在前其余按中文排序', () => {
    const merged = mergeCategories(
      [
        { id: null, name: '全部' },
        { id: 2, name: '旧名' },
      ],
      [
        { type_id: '2', type_name: '新名' },
        { type_id: '5', type_name: ' 啊 ' },
        { type_id: 'x', type_name: '坏' },
        { type_id: '7', type_name: '' },
      ]
    )
    expect(merged).toEqual([
      { id: null, name: '全部' },
      { id: 5, name: '啊' },
      { id: 2, name: '旧名' },
    ])
  })

  it('缓存键：插件 / MissAV 按分类名，CMS 按分类 id（无则 all）', () => {
    const base = {
      sourceApi: 's',
      categoryName: '中文',
      page: 2,
      sort: 'hot' as const,
    }
    expect(browseCacheKey({ ...base, byName: true, categoryId: 3 })).toBe(
      's|中文|2|hot'
    )
    expect(browseCacheKey({ ...base, byName: false, categoryId: 3 })).toBe(
      's|3|2|hot'
    )
    expect(browseCacheKey({ ...base, byName: false, categoryId: null })).toBe(
      's|all|2|hot'
    )
  })

  it('CMS 浏览地址：带页码，有分类才加 t', () => {
    expect(createBrowseUrl('https://x/api', 3, null)).toBe(
      'https://x/api?ac=detail&pg=3'
    )
    expect(createBrowseUrl('https://x/api', 1, 0)).toBe(
      'https://x/api?ac=detail&pg=1&t=0'
    )
  })

  it('有上限的缓存：超出时丢最早写入的', () => {
    const map = new Map<string, number>()
    for (let i = 0; i < 4; i++) rememberBounded(map, `k${i}`, i, 3)
    expect([...map.keys()]).toEqual(['k1', 'k2', 'k3'])
  })

  it('分页合并：追加时按 _uid 去重，替换时只留新页', () => {
    const a = [
      { _uid: 'a', v: 1 },
      { _uid: 'b', v: 1 },
    ]
    const b = [
      { _uid: 'b', v: 2 },
      { _uid: 'c', v: 2 },
    ]
    expect(mergePage(a, b, true)).toEqual([
      { _uid: 'a', v: 1 },
      { _uid: 'b', v: 2 },
      { _uid: 'c', v: 2 },
    ])
    expect(mergePage(a, b, false)).toEqual(b)
  })

  it('插件 tabs：兼容 config / data.config / 顶层三种位置，缺名叫「分类N」', () => {
    const tabs = [{ name: '热门', ext: { url: 'u' } }, {}]
    const expected = [
      { id: 0, name: '热门', ext: { url: 'u' } },
      { id: 1, name: '分类2', ext: {} },
    ]
    expect(parsePluginTabs({ config: { tabs } })).toEqual(expected)
    expect(parsePluginTabs({ data: { config: { tabs } } })).toEqual(expected)
    expect(parsePluginTabs({ tabs })).toEqual(expected)
    expect(parsePluginTabs({ tabs: 'x' })).toEqual([])
  })

  it('插件条目：vod_id 缺失用 ext.url，带插件标记', () => {
    const [item] = toPluginItems(
      [{ ext: { url: '/v/1' }, vod_name: 'n' }],
      'Jable'
    )
    expect(item).toMatchObject({
      vod_id: '/v/1',
      _uid: 'Jable-/v/1',
      _isPlugin: true,
      _siteName: 'Jable',
      _ext: { url: '/v/1' },
    })
  })

  it('MissAV：条目封面按番号拼、角标大写；分类 slug 与上次停留处', () => {
    const [item] = toMissavItems(
      [{ code: 'abc-123', title: 't', poster: '', duration: '' }],
      '中文字幕'
    )
    expect(item).toMatchObject({
      vod_remarks: 'ABC-123',
      vod_pic: 'https://fourhoi.com/abc-123/cover-t.jpg',
      _missavInput: 'abc-123',
      type_name: '中文字幕',
    })
    const { categories, match } = missavCategoriesFor({
      categoryId: 2,
      categoryName: '中文字幕',
      sort: 'hot',
    })
    expect(match.name).toBe('中文字幕')
    expect(missavSlug(categories, '中文字幕')).toBe('chinese-subtitle')
    expect(missavSlug(categories, '不存在')).toBe('new')
    expect(missavCategoriesFor(undefined).match.name).toBe('最新更新')
    // 拷贝而不是共享常量：改 ext 不影响下次
    categories[0].ext!.slug = 'x'
    expect(missavCategoriesFor(undefined).categories[0].ext!.slug).toBe('new')
  })
})

describe('AV 播放与搜索规则', () => {
  it('剧集解析：# 分集、$ 后最后一段为地址，空段跳过', () => {
    expect(
      parseCmsEpisodes({
        vod_play_url: '第1集$http://a.m3u8#$#第2集$x$http://b.m3u8',
      })
    ).toEqual([
      { name: '第1集', url: 'http://a.m3u8' },
      { name: '', url: '' },
      { name: '第2集', url: 'http://b.m3u8' },
    ])
    expect(parseCmsEpisodes(null)).toEqual([])
  })

  it('插件线路：只有带站点名且不是直链时才解析', () => {
    expect(needsPluginResolve('https://x/a.m3u8?t=1', 'S')).toBe(false)
    expect(needsPluginResolve('https://x/play/1', 'S')).toBe(true)
    expect(needsPluginResolve('https://x/play/1')).toBe(false)
    expect(needsPluginResolve('', 'S')).toBe(false)
  })

  it('播放历史：同地址只留一条并沿用进度，新的在前，最多 30 条', () => {
    const old = upsertPlayHistory([], { vod_name: 'A' }, '1', 'u1', 1)
    old[0].progress = 42
    old[0].duration = 100
    const next = upsertPlayHistory(old, { vod_name: 'A' }, '1', 'u1', 2)
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ progress: 42, duration: 100, timestamp: 2 })
    let many = next
    for (let i = 0; i < 40; i++)
      many = upsertPlayHistory(many, { vod_name: `v${i}` }, '', `x${i}`, i)
    expect(many).toHaveLength(30)
    expect(many[0].url).toBe('x39')
  })

  it('标题、下一集、列表下一部', () => {
    expect(playTitle('片', '第1集')).toBe('片 · 第1集')
    expect(playTitle('', '')).toBe('正在播放')
    const eps = [{ url: 'a' }, { url: 'b' }]
    expect(nextEpisode(eps, 'a')).toEqual({ url: 'b' })
    expect(nextEpisode(eps, 'b')).toBeNull()
    expect(nextEpisode(eps, 'z')).toBeNull()
    const groups = [
      { items: [{ vod_name: ' A ' }] },
      { items: [{ vod_name: 'B' }] },
    ]
    expect(nextInList(groups, 'a')).toEqual({ vod_name: 'B' })
    expect(nextInList(groups, 'B')).toBeNull()
  })

  it('同名合并：忽略大小写与首尾空白，保持首次出现的顺序', () => {
    const map = mergeByTitle([
      { vod_name: 'Foo', vod_pic: 'p1' },
      { vod_name: 'bar' },
      { vod_name: ' foo ', vod_pic: 'p2' },
    ])
    expect([...map.keys()]).toEqual(['foo', 'bar'])
    expect(map.get('foo')!.items).toHaveLength(2)
    expect(map.get('foo')!.vod_pic).toBe('p1')
  })

  it('搜索缓存键与站点顺序无关', () => {
    expect(searchCacheKey('k', ['b', 'a'])).toBe(
      searchCacheKey('k', ['a', 'b'])
    )
    expect(searchCacheKey('k', ['a'])).not.toBe(searchCacheKey('k2', ['a']))
  })

  it('插件搜索返回（与在线页共用 getVodList）：最多解两层 JSON 字符串，取 list 或 data.list', () => {
    const list = [{ vod_name: 'x' }]
    expect(getVodList({ list })).toEqual(list)
    expect(getVodList({ data: { list } })).toEqual(list)
    expect(getVodList(JSON.stringify(JSON.stringify({ list })))).toEqual(list)
    expect(getVodList('{坏')).toEqual([])
    expect(getVodList(null)).toEqual([])
  })

  it('收藏切换按 _uid', () => {
    const a = { _uid: 'a' }
    expect(toggleFavorite([], a)).toEqual([a])
    expect(toggleFavorite([a, { _uid: 'b' }], { _uid: 'a' })).toEqual([
      { _uid: 'b' },
    ])
  })

  it('限并发：同时进行不超过上限，结果顺序与输入一致', async () => {
    let running = 0
    let peak = 0
    const out = await mapWithConcurrency([5, 1, 3, 2, 4], 2, async n => {
      running++
      peak = Math.max(peak, running)
      await new Promise(r => setTimeout(r, n))
      running--
      return n * 10
    })
    expect(out).toEqual([50, 10, 30, 20, 40])
    expect(peak).toBe(2)
    expect(await mapWithConcurrency([], 3, async n => n)).toEqual([])
  })
})
