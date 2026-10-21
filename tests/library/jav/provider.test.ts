/**
 * 番号元数据源：站点优先级逐字段聚合、站点开关、结果缓存、网络失败与防护页熔断、入库形状、设置合并与校验。
 */
import { describe, expect, it } from 'vitest'
import { looksLikeImage } from '../../../src/main/library/images/image-cache'
import type {
  CacheEntry,
  ResponseCache,
} from '../../../src/main/library/providers/http/provider-cache'
import { ProviderHttp } from '../../../src/main/library/providers/http/provider-http'
import {
  aggregate,
  toMetadata,
} from '../../../src/main/library/providers/jav/aggregate'
import {
  JavProvider,
  pageVerdict,
} from '../../../src/main/library/providers/jav/jav-provider'
import { mergeJavSettings } from '../../../src/main/library/providers/jav/jav-settings'
import type {
  JavRecord,
  JavSite,
} from '../../../src/main/library/providers/jav/types'
import {
  DEFAULT_JAV_SETTINGS,
  type JavSettings,
  LibraryError,
  parseRpcParams,
} from '../../../src/shared/library/ipc'

const record = (
  site: JavRecord['site'],
  patch: Partial<JavRecord> = {}
): JavRecord => ({
  site,
  code: 'SSIS-497',
  url: `https://${site}/SSIS-497`,
  tags: [],
  actors: [],
  stills: [],
  ...patch,
})

/** 内存缓存。 */
class MemoryCache implements ResponseCache {
  readonly map = new Map<string, CacheEntry>()
  get(key: string): CacheEntry | undefined {
    return this.map.get(key)
  }
  set(key: string, entry: CacheEntry): void {
    this.map.set(key, entry)
  }
  touch(key: string, expiresAt: number): void {
    const entry = this.map.get(key)
    if (entry) this.map.set(key, { ...entry, expiresAt })
  }
}

/** 假站点：返回固定结果或抛错，记录调用次数。 */
function site(
  id: JavRecord['site'],
  result: JavRecord | null | Error,
  kinds = ['censored']
): JavSite & { calls: number } {
  const s = {
    id,
    calls: 0,
    supports: (kind: string) => kinds.includes(kind),
    fetch: async () => {
      s.calls++
      if (result instanceof Error) throw result
      return result
    },
  }
  return s
}

const noHttp = new ProviderHttp({
  fetch: async () => ({
    status: 500,
    headers: { get: () => null },
    text: async () => '',
  }),
})

function provider(
  sites: JavSite[],
  settings: JavSettings = DEFAULT_JAV_SETTINGS,
  cache?: ResponseCache
): JavProvider {
  return new JavProvider({
    http: noHttp,
    sites,
    settings: () => settings,
    cache,
    now: () => 1000,
  })
}

describe('聚合', () => {
  it('按优先级逐字段取第一个非空值；列表不跨站合并；头像可由其他站补', () => {
    const movie = aggregate([
      record('javbus', {
        title: '标题A',
        studio: 'S1',
        tags: ['巨乳'],
        actors: [{ name: '鷲尾めい' }],
        cover: 'https://a/cover.jpg',
      }),
      record('avbase', {
        title: '标题B',
        director: '导演B',
        overview: '简介B',
        tags: ['単体作品', '巨乳'],
        actors: [
          { name: '鷲尾めい', photo: 'https://b/p.jpg' },
          { name: '别人' },
        ],
        poster: 'https://b/poster.jpg',
      }),
    ])!
    expect(movie).toMatchObject({
      code: 'SSIS-497',
      title: '标题A',
      studio: 'S1',
      director: '导演B',
      overview: '简介B',
      tags: ['巨乳'],
      actors: [{ name: '鷲尾めい', photo: 'https://b/p.jpg' }],
      cover: 'https://a/cover.jpg',
      poster: 'https://b/poster.jpg',
    })
    expect(movie.sources).toMatchObject({
      title: 'javbus',
      director: 'avbase',
      tags: 'javbus',
    })
    expect(aggregate([])).toBeNull()
  })

  it('入库形状：标题带番号、制作商与发行商进 companies、系列进 collection、图片是绝对地址', () => {
    const meta = toMetadata(
      aggregate([
        record('javbus', {
          title: '片名',
          releaseDate: '2022-08-19',
          runtimeMinutes: 120,
          director: '导演',
          studio: '制作商',
          label: '发行商',
          series: '系列',
          tags: ['巨乳'],
          actors: [{ name: '演员', photo: 'https://a/p.jpg' }],
          cover: 'https://a/c.jpg',
          poster: 'https://a/t.jpg',
          stills: ['https://a/1.jpg'],
        }),
      ])!
    )
    expect(meta).toMatchObject({
      ref: { provider: 'jav', kind: 'movie', id: 'SSIS-497' },
      title: 'SSIS-497 片名',
      originalTitle: '片名',
      year: 2022,
      releaseDate: '2022-08-19',
      runtimeMinutes: 120,
      genres: ['巨乳'],
      companies: ['制作商', '发行商'],
      collection: { id: '系列', name: '系列' },
      cast: [
        { id: '演员', name: '演员', order: 0, profilePath: 'https://a/p.jpg' },
      ],
      crew: [{ name: '导演', job: 'Director' }],
      externalIds: {},
    })
    expect(meta.images.map(i => [i.role, i.path])).toEqual([
      ['poster', 'https://a/t.jpg'],
      ['backdrop', 'https://a/c.jpg'],
      ['still', 'https://a/1.jpg'],
    ])
    // 没有竖版海报时封面顶上
    const noPoster = toMetadata(
      aggregate([record('javbus', { cover: 'https://a/c.jpg' })])!
    )
    expect(noPoster.images[0]).toMatchObject({
      role: 'poster',
      path: 'https://a/c.jpg',
    })
    expect(noPoster.title).toBe('SSIS-497')
  })
})

describe('JavProvider', () => {
  it('站点按设置排序、关掉的不查、不支持该类番号的不查', async () => {
    const bus = site('javbus', record('javbus', { title: 'A' }))
    const base = site('avbase', record('avbase', { title: 'B', director: 'D' }))
    const fc = site('fc2', record('fc2', { title: 'F' }), ['fc2'])
    const reordered: JavSettings = {
      sites: [
        { id: 'avbase', enabled: true },
        { id: 'javbus', enabled: true },
        { id: 'fc2', enabled: true },
      ],
    }
    const meta = await provider([bus, base, fc], reordered).metadata('SSIS-497')
    expect(meta?.title).toBe('SSIS-497 B')
    expect(fc.calls).toBe(0)
    const off: JavSettings = {
      sites: [
        { id: 'javbus', enabled: false },
        { id: 'avbase', enabled: true },
        { id: 'fc2', enabled: true },
      ],
    }
    const only = await provider(
      [
        site('javbus', record('javbus', { title: 'A' })),
        site('avbase', record('avbase', { title: 'B' })),
      ],
      off
    ).metadata('ssis00497')
    expect(only?.title).toBe('SSIS-497 B')
  })

  it('查无此片返回 null；全部站点网络失败抛错（计为失败而不是未匹配）', async () => {
    expect(
      await provider([site('javbus', null), site('avbase', null)]).metadata(
        'SSIS-497'
      )
    ).toBeNull()
    await expect(
      provider([
        site('javbus', new Error('boom')),
        site('avbase', new Error('boom')),
      ]).metadata('SSIS-497')
    ).rejects.toThrow(/都无法访问/)
    // 一个站失败、另一个有结果：用有结果的
    const partial = await provider([
      site('javbus', new Error('boom')),
      site('avbase', record('avbase', { title: 'B' })),
    ]).metadata('SSIS-497')
    expect(partial?.title).toBe('SSIS-497 B')
  })

  it('站点结果按「站点 + 番号」缓存，网络失败不缓存', async () => {
    const cache = new MemoryCache()
    const bus = site('javbus', record('javbus', { title: 'A' }))
    const base = site('avbase', new Error('down'))
    const p = provider([bus, base], DEFAULT_JAV_SETTINGS, cache)
    await p.metadata('SSIS-497')
    await p.metadata('SSIS-497')
    expect(bus.calls).toBe(1)
    expect(base.calls).toBe(2)
    expect([...cache.map.keys()]).toEqual(['jav:javbus:SSIS-497'])
  })

  it('经 ProviderHttp 取页：带 UA / Cookie；防护页熔断后同主机不再请求', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = []
    const http = new ProviderHttp({
      maxRetries: 0,
      fetch: async (url, init) => {
        seen.push({ url, headers: init.headers })
        return {
          status: 200,
          headers: { get: () => null },
          text: async () =>
            '<html><title>Just a moment...</title><script>cf_chl_opt={}</script></html>',
        }
      },
    })
    const javSite: JavSite = {
      id: 'javbus',
      supports: () => true,
      fetch: async (_code, ctx) => {
        await ctx.page('https://www.javbus.com/SSIS-497', { cookie: 'dv=1' })
        return null
      },
    }
    const p = new JavProvider({
      http,
      sites: [javSite],
      settings: () => DEFAULT_JAV_SETTINGS,
    })
    for (let i = 0; i < 4; i++)
      await expect(p.metadata('SSIS-497')).rejects.toThrow()
    // 挑战页连续 3 次后熔断，第 4 次不再发请求
    expect(seen).toHaveLength(3)
    expect(seen[0].headers.Cookie).toBe('dv=1')
    expect(seen[0].headers['User-Agent']).toMatch(/Chrome\//)
  })

  it('正常页面带 Cloudflare 统计脚本不算挑战页', () => {
    const page = `<html><h3>SSIS-497</h3><script>a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js'</script></html>`
    expect(pageVerdict(page)).toBe('ok')
    expect(pageVerdict('<title>Just a moment...</title>')).toBe('challenge')
  })
})

describe('番号站点设置', () => {
  it('合并：丢掉未知 / 重复站点，缺的站点按默认开启排在最后', () => {
    expect(
      mergeJavSettings({
        sites: [
          { id: 'fc2', enabled: false },
          { id: 'nope' as 'fc2', enabled: true },
          { id: 'fc2', enabled: true },
        ],
      })
    ).toEqual({
      sites: [
        { id: 'fc2', enabled: false },
        { id: 'javbus', enabled: true },
        { id: 'avbase', enabled: true },
      ],
    })
    expect(mergeJavSettings(undefined)).toEqual(DEFAULT_JAV_SETTINGS)
  })

  it('IPC 校验：未知站点、重复、非布尔开关都拒绝；添加番号库只能是电影库', () => {
    const ok = { sites: [{ id: 'avbase', enabled: false }] }
    expect(parseRpcParams('jav.setSettings', ok)).toEqual(ok)
    for (const bad of [
      null,
      { sites: 'x' },
      { sites: [{ id: 'x', enabled: true }] },
      {
        sites: [
          { id: 'fc2', enabled: true },
          { id: 'fc2', enabled: true },
        ],
      },
      { sites: [{ id: 'fc2', enabled: 'yes' }] },
    ]) {
      expect(() => parseRpcParams('jav.setSettings', bad)).toThrow(LibraryError)
    }
    expect(
      parseRpcParams('addLibrary', { root: '/a', kind: 'movie' }).source
    ).toBe('tmdb')
    expect(
      parseRpcParams('addLibrary', { root: '/a', kind: 'movie', source: 'jav' })
        .source
    ).toBe('jav')
    expect(() =>
      parseRpcParams('addLibrary', { root: '/a', kind: 'tv', source: 'jav' })
    ).toThrow(LibraryError)
  })
})

describe('图片文件头', () => {
  it('octet-stream 图床按文件头确认是图片', () => {
    expect(looksLikeImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(true)
    expect(looksLikeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(true)
    expect(looksLikeImage(new TextEncoder().encode('RIFF1234WEBPVP8 '))).toBe(
      true
    )
    expect(looksLikeImage(new TextEncoder().encode('<html>'))).toBe(false)
  })
})
