import { describe, expect, it, vi } from 'vitest'

import {
  createSourceSessions,
  favoriteItemOf,
  resolveEpisode,
  viewDetail,
} from '../../src/server/view/detail'
import {
  type SourceDeps,
  searchSources,
  sourceSites,
} from '../../src/server/view/sources'
import { DomainRegistry } from '../../src/server/domains/registry'
import { view } from '../../src/shared/contract/view'
import type {
  GetJsonResponse,
  VodRequest,
} from '../../src/shared/contract/online'
import type { DoubanMetadata } from '../../src/shared/douban/detail'
import type { EpisodeGroup } from '../../src/shared/online/types'
import { isDoubanItem } from '../../src/shared/playback/favorites'

const CMS_A = 'https://cms-a.example.com/api.php/provide/vod/'
const CMS_B = 'https://cms-b.example.com/api.php/provide/vod/'

/** CMS 列表接口：wd= 搜索、ids= 详情 */
function cmsJson(url: string): GetJsonResponse {
  const u = new URL(url)
  const api = `${u.origin}${u.pathname}`
  if (api === CMS_B) return { success: false as const, error: '超时' }
  const wd = u.searchParams.get('wd')
  if (wd)
    return {
      success: true as const,
      data: {
        list: [
          { vod_id: 1, vod_name: '小城良方' },
          { vod_id: 2, vod_name: '别的片' },
          { vod_name: '缺 id 的坏条目' },
        ],
      },
    }
  return {
    success: true as const,
    data: {
      list: [
        {
          vod_id: u.searchParams.get('ids'),
          vod_name: '小城良方',
          vod_play_from: 'm3u8',
          vod_play_url: '第1集$https://v.a/1.m3u8#第2集$https://v.a/2.m3u8',
        },
      ],
    },
  }
}

function deps(over: Partial<SourceDeps> = {}): SourceDeps {
  return {
    cmsSites: () => [
      { name: '站A', api: CMS_A },
      { name: '站B', api: CMS_B },
    ],
    pluginSites: async () => [
      { name: '插件甲', type: 3, api: 'csp_a', ext: '' },
      // site-selection 里登记的成人插件：不该被请求
      { name: '成人', type: 3, api: 'csp_jable', ext: '' },
    ],
    getJson: vi.fn(async url => cmsJson(url)),
    vod: vi.fn(async (req: VodRequest) => {
      if (req.action === 'search')
        return {
          success: true,
          data: { list: [{ vod_id: 'p1', vod_name: '小城良方 (2026)' }] },
        }
      if (req.action === 'getTracks')
        return {
          success: true,
          data: {
            list: [
              {
                name: '线路1',
                tracks: [{ name: 'E1', ext: { url: 'play/1', id: 7 } }],
              },
            ],
          },
        }
      return { success: false }
    }),
    ...over,
  }
}

async function collect(d: SourceDeps): Promise<EpisodeGroup[]> {
  const groups: EpisodeGroup[] = []
  await searchSources('小城良方', d, g => groups.push(...g))
  return groups
}

describe('服务端选源（ADR-0030）', () => {
  it('CMS 与插件里片名匹配的条目取到线路；站点失败只少它一个', async () => {
    const d = deps()
    const groups = await collect(d)

    expect(groups.map(g => g._siteName).sort()).toEqual(['插件甲', '站A'])
    const cms = groups.find(g => g._siteName === '站A')!
    expect(cms.episodes.map(e => e.url)).toEqual([
      'https://v.a/1.m3u8',
      'https://v.a/2.m3u8',
    ])
    // 不匹配的「别的片」不去取详情
    const detailCalls = vi
      .mocked(d.getJson)
      .mock.calls.filter(([url]) => url.includes('ids='))
    expect(detailCalls).toHaveLength(1)
  })

  it('成人插件不请求', async () => {
    const d = deps()
    await collect(d)
    const sites = vi.mocked(d.vod).mock.calls.map(([req]) => req.siteName)
    expect(sites).not.toContain('成人')
  })

  it('插件站点清单取不到时照样返回 CMS 的结果', async () => {
    const groups = await collect(
      deps({
        pluginSites: async () => {
          throw new Error('引擎没起来')
        },
      })
    )
    expect(groups.map(g => g._siteName)).toEqual(['站A'])
  })

  it('站点列表插件在前，剧集带上插件站点名和 JSON 参数', async () => {
    const sites = sourceSites(await collect(deps()))
    expect(sites.map(s => [s.siteName, s.kind])).toEqual([
      ['插件甲', 'catspider'],
      ['站A', 'cms'],
    ])
    const ep = sites[0].lines[0].episodes[0]
    expect(ep).toMatchObject({ name: 'E1', siteName: '插件甲' })
    expect(JSON.parse(ep.ext!)).toEqual({ url: 'play/1', id: 7 })
    expect(sites[1].lines[0].episodes[0]).toMatchObject({
      siteName: null,
      ext: null,
    })
  })
})

describe('选源会话', () => {
  const settle = (): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, 0))

  it('开始后陆续有结果，结束后 done；同一部片复用会话', async () => {
    let n = 0
    const sessions = createSourceSessions(deps(), Date.now, () => `s${++n}`)
    const first = sessions.start('小城良方')
    expect(first).toEqual({
      sessionId: 's1',
      done: false,
      probing: false,
      sites: [],
    })
    await vi.waitFor(() => expect(sessions.get('s1')?.done).toBe(true))
    expect(sessions.get('s1')?.sites).toHaveLength(2)
    expect(sessions.start('小城 良方').sessionId).toBe('s1')
  })

  it('没找到任何源的会话不复用；未知会话为 null', async () => {
    let n = 0
    const empty = deps({
      cmsSites: () => [],
      pluginSites: async () => [],
    })
    const sessions = createSourceSessions(empty, Date.now, () => `s${++n}`)
    sessions.start('没有的片')
    await settle()
    await vi.waitFor(() => expect(sessions.get('s1')?.done).toBe(true))
    expect(sessions.start('没有的片').sessionId).toBe('s2')
    expect(sessions.get('nope')).toBeNull()
  })

  it('结束超过 10 分钟的会话被清掉', async () => {
    let now = 0
    let n = 0
    const sessions = createSourceSessions(
      deps(),
      () => now,
      () => `s${++n}`
    )
    sessions.start('小城良方')
    await vi.waitFor(() => expect(sessions.get('s1')?.done).toBe(true))
    now = 11 * 60 * 1000
    expect(sessions.start('别的').sessionId).toBe('s2')
    expect(sessions.get('s1')).toBeNull()
  })
})

describe('选源会话的收尾', () => {
  it('客户端 15 秒没来取结果，剩下的站点不再请求', async () => {
    let now = 0
    const sites = Array.from({ length: 12 }, (_, i) => ({
      name: `站${i}`,
      api: `https://cms${i}.example.com/api.php/provide/vod/`,
    }))
    const getJson = vi.fn(async () => {
      now += 20_000
      return { success: true as const, data: { list: [] } }
    })
    const sessions = createSourceSessions(
      deps({ cmsSites: () => sites, pluginSites: async () => [], getJson }),
      () => now,
      () => 's1'
    )
    sessions.start('小城良方')
    await vi.waitFor(() => expect(sessions.get('s1')?.done).toBe(true))
    expect(getJson.mock.calls.length).toBeLessThan(sites.length)
  })

  it('有站点一直不返回时 90 秒后收尾，同一部片不再复用卡住的会话', async () => {
    vi.useFakeTimers()
    try {
      let n = 0
      const sessions = createSourceSessions(
        deps({
          cmsSites: () => [],
          vod: () => new Promise(() => {}),
        }),
        Date.now,
        () => `s${++n}`
      )
      sessions.start('小城良方')
      await vi.advanceTimersByTimeAsync(90_000)
      expect(sessions.get('s1')).toMatchObject({ done: true, sites: [] })
      expect(sessions.start('小城良方').sessionId).toBe('s2')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('解析播放地址', () => {
  const playDeps = {
    playinfo: vi.fn(async () => ({ urls: ['https://cdn.x/real.m3u8'] })),
    resolvePage: vi.fn(async (url: string) =>
      url.includes('page') ? 'https://cdn.x/from-page.m3u8' : url
    ),
  }

  it('插件条目先让插件解析，换成播放代理路径', async () => {
    const r = await resolveEpisode(
      { url: 'play/1', siteName: '插件甲', ext: { url: 'play/1', id: 7 } },
      playDeps
    )
    expect(r).toEqual({
      url: `/api/stream?src=${encodeURIComponent('https://cdn.x/real.m3u8')}`,
      direct: true,
      hls: true,
    })
  })

  it('页面地址从页面里找 m3u8；线路自带的 Referer 进代理参数', async () => {
    const page = await resolveEpisode(
      { url: 'https://site/page/1', siteName: null, ext: null },
      playDeps
    )
    expect(page.url).toContain(encodeURIComponent('from-page.m3u8'))

    const withHeader = await resolveEpisode(
      {
        url: 'https://cdn.y/a.mp4|referer=https://site/',
        siteName: null,
        ext: null,
      },
      playDeps
    )
    expect(withHeader.url).toContain('referer=')
    expect(withHeader).toMatchObject({ direct: true, hls: false })
  })

  it('空地址返回空，不拼代理路径', async () => {
    expect(
      await resolveEpisode({ url: '', siteName: null, ext: null }, playDeps)
    ).toEqual({ url: '', direct: false, hls: false })
  })
})

describe('详情与入参', () => {
  it('豆瓣元数据换成详情视图，图片走缩略图', () => {
    const meta: DoubanMetadata = {
      id: '123',
      kind: 'tv',
      title: '小城良方',
      originalTitle: '',
      year: '2026',
      genres: ['剧情'],
      countries: ['中国大陆'],
      cardSubtitle: '',
      rating: { value: 8, count: 100 },
      cover: 'https://img.doubanio.com/p.jpg',
      intro: '简介',
      duration: '45分钟',
      directors: ['导演'],
      actors: [{ name: '演员', photo: '' }],
      images: [{ thumb: 'https://img.doubanio.com/s.jpg', full: '' }],
      backdrop: '',
    }
    const d = viewDetail(meta, true)
    expect(d).toMatchObject({
      rating: '豆瓣 8.0',
      favorite: true,
      overview: '简介',
      backdrop: null,
      actors: [{ name: '演员', photo: null }],
    })
    expect(d.poster).toMatch(/^\/media\/thumb\?w=480&src=/)
    expect(d.images).toHaveLength(1)
  })

  it('契约拒绝不合法的豆瓣 ID、空片名、坏掉的插件参数', async () => {
    const registry = new DomainRegistry()
    registry.implement(view, {
      home: async () => {
        throw new Error('unused')
      },
      recent: () => [],
      favorites: () => [],
      search: async () => [],
      browse: async () => ({ title: '', items: [], next: null }),
      detail: async () => null,
      favorite: async () => false,
      sourcesStart: () => ({ sessionId: 'x', done: true, sites: [] }),
      sources: () => null,
      resume: () => null,
      resolve: async () => ({ url: '', direct: false, hls: false }),
    })
    for (const [method, args] of [
      ['detail', ['abc', 'movie']],
      ['sourcesStart', ['   ']],
      ['resolve', [{ url: 'u', ext: '{坏' }]],
      ['resolve', [{ url: 'u', ext: '[1]' }]],
    ] as const)
      expect(await registry.invoke('view', method, [...args])).toMatchObject({
        ok: false,
      })
  })
})

describe('收藏卡', () => {
  it('按豆瓣详情拼出的收藏卡与桌面收藏同形状', () => {
    const item = favoriteItemOf({
      id: '123',
      kind: 'tv',
      title: '片',
      originalTitle: 'Orig',
      year: '2026',
      genres: [],
      countries: [],
      cardSubtitle: '',
      rating: { value: 7.95, count: 1 },
      cover: 'https://img.doubanio.com/p.jpg',
      intro: '简介',
      duration: '',
      directors: [],
      actors: [],
      images: [],
      backdrop: '',
    })
    expect(isDoubanItem(item)).toBe(true)
    expect(item).toMatchObject({
      url: 'https://movie.douban.com/subject/123/',
      rate: '8.0',
      type: '剧集',
      kind: 'tv',
    })
    expect(item).not.toHaveProperty('backdrop')
  })
})
