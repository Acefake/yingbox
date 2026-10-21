import { describe, expect, it } from 'vitest'
import {
  cmsDetailSources,
  parseCatSpiderGroups,
  parseCmsGroups,
  toCatSpiderSearchItems,
} from '../src/renderer/src/features/online/utils/vod-payload'
import {
  firstPlayUrl,
  getVodList,
  normalizeVodPayload,
} from '../src/renderer/src/utils/vod-data'
import {
  migrateCmsApis,
  planCatSpiderSelection,
} from '../src/renderer/src/features/online/utils/site-selection'
import {
  buildFallbacks,
  buildPlaylist,
  groupBySite,
  guessMediaType,
  mergeOnlineHistory,
  normalizeTitle,
  preferredSourceType,
  sourceKey,
  sourceTypeOptions,
  splitBySourceType,
  titleMatches,
  tmdbImage,
} from '../src/renderer/src/features/online/utils/detail-sources'
import {
  connectionRank,
  countFailed,
  sortByConnection,
  sourceTabs,
  validateCustomSource,
} from '../src/renderer/src/features/online/utils/source-rules'
import type { EpisodeGroup } from '../src/renderer/src/features/online/types'

const site = (
  api: string,
  name = api
): { api: string; name: string; type: number; ext: string } => ({
  api,
  name,
  type: 3,
  ext: '',
})

describe('在线返回数据解析', () => {
  it('payload：最多解两层 JSON 字符串，非对象返回 null', () => {
    const obj = { list: [1] }
    expect(normalizeVodPayload(JSON.stringify(JSON.stringify(obj)))).toEqual(
      obj
    )
    expect(normalizeVodPayload('{坏')).toBeNull()
    expect(normalizeVodPayload('"字符串"')).toBeNull()
    expect(normalizeVodPayload(42)).toBeNull()
  })

  it('list：顶层优先，其次 data.list（data 也可能是 JSON 字符串）', () => {
    expect(getVodList({ list: [1], data: { list: [2] } })).toEqual([1])
    expect(getVodList({ data: JSON.stringify({ list: [2] }) })).toEqual([2])
    expect(getVodList({ list: 'x' })).toEqual([])
  })

  it('CMS 线路：$$$ 分线路、# 分集、只留 http(s)；多线路标签带站点名与来源名', () => {
    const groups = parseCmsGroups(
      {
        vod_play_from: 'm3u8$$$ftp',
        vod_play_url:
          '第1集$https://a/1.m3u8#$http://a/2#坏$ftp://x$$$x$ftp://y',
      } as any,
      '站A'
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('站A-m3u8')
    expect(groups[0].episodes).toEqual([
      { name: '第1集', url: 'https://a/1.m3u8' },
      { name: '第2集', url: 'http://a/2' },
    ])
    expect(groups[0]).toMatchObject({ _source: 'cms', _siteName: '站A' })
    const single = parseCmsGroups({ vod_play_url: 'a$https://x' } as any, '站B')
    expect(single[0].label).toBe('站B')
    expect(parseCmsGroups(undefined, '站')).toEqual([])
  })

  it('插件线路：tracks / 苹果 CMS / list 三种写法', () => {
    const groups = parseCatSpiderGroups(
      [
        {
          name: '线路1',
          tracks: [
            { name: 'E1', ext: { url: 'u1', id: 7 } },
            { title: 'E2', url: 'u2' },
          ],
        },
        { vod_play_from: '荐片', vod_play_url: '1$http://j/1#2$ftp://no' },
        { vod_play_url: 'a$http://m/1$$$b$http://m/2', vod_play_from: 'x$$$' },
        { list: [{ title: 'L1', url: 'l1' }] },
        { other: true },
      ],
      '站'
    )
    expect(groups.map(g => g.label)).toEqual([
      '线路1',
      '荐片',
      '站-x',
      '站-2',
      '站',
    ])
    expect(groups[0].episodes).toEqual([
      { name: 'E1', url: 'u1', ext: { url: 'u1', id: 7 } },
      { name: 'E2', url: 'u2', ext: { url: 'u2' } },
    ])
    expect(groups[1].episodes).toEqual([
      { name: '1', url: 'http://j/1', ext: {} },
    ])
    expect(groups.every(g => g._source === 'catspider' && g.hasDirect)).toBe(
      true
    )
  })

  it('插件搜索条目：vod_id 缺失用 ext.url，简介兼容 vod_desc', () => {
    const [item] = toCatSpiderSearchItems(
      [{ ext: { url: '/d/1' }, vod_desc: '简介' }],
      site('csp_x', '站')
    )
    expect(item).toMatchObject({
      vod_id: '/d/1',
      vod_content: '简介',
      _source: 'catspider',
      _siteName: '站',
      _ext: { url: '/d/1' },
    })
  })

  it('详情来源：聚合条目用 sources，否则用自身 api_url；播放地址取第一个', () => {
    const sources = [{ source_name: 'a', api_url: 'x', vod_id: 1 }]
    expect(cmsDetailSources({ sources, api_url: 'y' } as any)).toBe(sources)
    expect(cmsDetailSources({ api_url: 'y', vod_id: 2 } as any)).toEqual([
      { source_name: '未知', api_url: 'y', vod_id: 2 },
    ])
    expect(cmsDetailSources({} as any)).toEqual([])
    expect(firstPlayUrl({ data: { urls: ['a', 'b'] } })).toBe('a')
    expect(firstPlayUrl({})).toBe('')
  })
})

describe('站点启用列表', () => {
  const sites = [site('a'), site('b'), site('csp_jable')]
  const plan = (
    o: Partial<Parameters<typeof planCatSpiderSelection>[0]>
  ): string[] =>
    planCatSpiderSelection({
      sites,
      stored: [],
      hasStored: true,
      fallbackApis: ['f1', 'f2'],
      adultSeeded: true,
      ...o,
    })

  it('首次或仍是旧 fallback：启用全部非成人源', () => {
    expect(plan({ hasStored: false })).toEqual(['a', 'b'])
    expect(plan({ stored: ['f2', 'f1'] })).toEqual(['a', 'b'])
  })
  it('用户自己的选择：只清掉清单里没有的', () => {
    expect(plan({ stored: ['b', 'gone'] })).toEqual(['b'])
  })
  it('成人插件源只在未播种时补进去一次', () => {
    expect(plan({ stored: ['b'], adultSeeded: false })).toEqual([
      'b',
      'csp_jable',
    ])
    expect(plan({ stored: ['b'], adultSeeded: true })).toEqual(['b'])
  })
  it('CMS 旧地址迁移并去重', () => {
    expect(
      migrateCmsApis([
        'https://hhzyapi.com/api.php/provide/vod',
        'https://haohuazy.com/api.php/provide/vod/',
        'keep',
      ])
    ).toEqual(['https://haohuazy.com/api.php/provide/vod/', 'keep'])
  })
})

describe('在线详情页规则', () => {
  const line = (
    label: string,
    siteName: string | undefined,
    eps: [string, string][],
    source?: 'cms' | 'catspider'
  ): EpisodeGroup => ({
    label,
    _siteName: siteName,
    _source: source,
    hasDirect: true,
    episodes: eps.map(([name, url]) => ({ name, url })),
  })

  it('片名匹配：去括号与标点、忽略大小写，相等或互相包含；空的不算', () => {
    expect(normalizeTitle('流浪地球2 (2023)【国语】')).toBe('流浪地球2国语')
    expect(normalizeTitle('[HD] Foo: Bar')).toBe('foobar')
    expect(titleMatches('流浪地球2', '流浪地球')).toBe(true)
    expect(titleMatches('流浪', '流浪地球')).toBe(true)
    expect(titleMatches('三体', '流浪地球')).toBe(false)
    expect(titleMatches('', '流浪地球')).toBe(false)
  })

  it('来源去重键：类型 + 站点名 / 接口 / id', () => {
    expect(
      sourceKey({ _source: 'catspider', _siteName: 'S', api_url: 'x' })
    ).toBe('catspider:S')
    expect(sourceKey({ _source: 'cms', api_url: 'x' })).toBe('cms:x')
    expect(sourceKey(null)).toBe('unknown:')
  })

  it('来源类型：没有 _source 的归 CMS；有插件线路时优先插件；切换项只列有的', () => {
    const groups = [
      line('a', 'S', [], 'catspider'),
      line('b', 'T', []),
      line('c', 'U', [], 'cms'),
    ]
    const { catspider, cms } = splitBySourceType(groups)
    expect([catspider.length, cms.length]).toEqual([1, 2])
    expect(preferredSourceType(groups)).toBe('catspider')
    expect(preferredSourceType([groups[1]])).toBe('cms')
    expect(sourceTypeOptions(0, 2)).toEqual([
      { value: 'cms', label: 'CMS 源 · 2' },
    ])
    expect(sourceTypeOptions(1, 0).map(o => o.value)).toEqual(['catspider'])
  })

  it('按站点归组：站点名缺失时用线路名，保持顺序', () => {
    const sg = groupBySite([
      line('A-1', 'A', []),
      line('X', undefined, []),
      line('A-2', 'A', []),
    ])
    expect(sg.map(s => [s.siteName, s.lines.map(l => l.label)])).toEqual([
      ['A', ['A-1', 'A-2']],
      ['X', ['X']],
    ])
  })

  it('连播队列带站点名；同集备用线路先按集名、再按集序，跳过当前线路与重复', () => {
    const cur = line('A-1', 'A', [
      ['第1集', 'a1'],
      ['第2集', 'a2'],
    ])
    expect(buildPlaylist(cur)).toEqual([
      { url: 'a1', name: '第1集', siteName: 'A' },
      { url: 'a2', name: '第2集', siteName: 'A' },
    ])
    expect(buildPlaylist(undefined)).toEqual([])
    const sg = groupBySite([
      cur,
      line('A-2', 'A', [
        ['第2集', 'b2'],
        ['第1集', 'b1'],
      ]),
      line('C', undefined, [
        ['01', 'c1'],
        ['02', 'c2'],
      ]),
      line('D', 'D', [['x', '']]),
    ])
    expect(buildFallbacks(sg, cur, '第1集', 0)).toEqual([
      { url: 'b1', name: 'A · A-2', siteName: 'A' },
      { url: 'c1', name: 'C · C' },
    ])
    expect(buildFallbacks(sg, cur, '', 5)).toEqual([])
  })

  it('播放历史：新记录在前，同片（按 id / 名称）与同地址去重，最多 30 条', () => {
    const history = [
      { item: { vod_id: 1 }, url: 'old' },
      { vod_name: '别的', url: 'same' },
      { vod_name: '另一部', url: 'x' },
      {},
    ]
    const merged = mergeOnlineHistory(history, { vod_id: 1, url: 'same' }, '1')
    expect(merged.map(e => e.url)).toEqual(['same', 'x'])
    const many = Array.from({ length: 40 }, (_, i) => ({
      vod_id: i,
      url: `u${i}`,
    }))
    expect(
      mergeOnlineHistory(many, { vod_id: 'n', url: 'n' }, 'n')
    ).toHaveLength(30)
  })

  it('媒体类型与 TMDB 图片地址', () => {
    expect(guessMediaType('国产剧')).toBe('tv')
    expect(guessMediaType('动作片')).toBe('movie')
    expect(tmdbImage('w342', '/p.jpg')).toBe(
      'https://images.tmdb.org/t/p/w342/p.jpg'
    )
    expect(tmdbImage('w342', null)).toBe('')
  })
})

describe('数据源面板规则', () => {
  it('按连通状态排序：可用 < 检测中 < 未检测 < 失效，同状态保持原顺序', () => {
    const status: Record<string, any> = {
      a: 'fail',
      b: 'ok',
      c: 'unknown',
      d: 'checking',
      e: 'ok',
    }
    const sites = ['a', 'b', 'c', 'd', 'e'].map(api => ({ api }))
    expect(sortByConnection(sites, api => status[api]).map(s => s.api)).toEqual(
      ['b', 'e', 'd', 'c', 'a']
    )
    expect(sites[0].api).toBe('a')
    expect(connectionRank('fail')).toBeGreaterThan(connectionRank('unknown'))
  })

  it('失效计数', () => {
    expect(
      countFailed(['a', 'b', 'c'], { a: 'fail', b: 'ok', c: 'fail' })
    ).toBe(2)
  })

  it('自定义源校验：必填、协议、重复', () => {
    expect(validateCustomSource('', 'https://x', [])?.level).toBe('warning')
    expect(validateCustomSource('n', 'ftp://x', [])?.level).toBe('error')
    expect(validateCustomSource('n', '不是地址', [])?.level).toBe('error')
    expect(validateCustomSource('n', 'https://x', ['https://x'])?.level).toBe(
      'info'
    )
    expect(validateCustomSource('n', 'http://x/api', ['https://x'])).toBeNull()
  })

  it('分类标签：AV 只在成人模式下出现', () => {
    expect(sourceTabs(3, null)).toEqual([
      { value: 'online', label: '在线源 3' },
    ])
    expect(sourceTabs(3, 5).map(t => t.label)).toEqual(['在线源 3', 'AV 源 5'])
  })
})
