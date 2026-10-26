/**
 * frodo 回退接到两个用途上：
 * - 库外发现 / 在线首页的豆瓣浏览（engine/online/douban-browse.ts）：同一份页缓存、同一个熔断器；
 * - 本地片补类型（main/library/providers/douban/douban-genres.ts）：同一个低速 ProviderHttp（令牌桶）、
 *   同一个缓存键（provider_cache 不区分来源）。
 * 全部用假网络 + 真实接口裁剪的夹具（tests/fixtures/douban）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createDoubanBrowse } from '../../src/engine/online/douban-browse'
import { LibraryService } from '../../src/main/library/engine/service'
import { createGenreFill } from '../../src/main/library/identify/genre-fill'
import {
  DoubanGenreLookup,
  type DoubanGenreQuery,
} from '../../src/main/library/providers/douban/douban-genres'
import { MemoryResponseCache } from '../../src/main/library/providers/http/provider-cache'
import {
  type FetchLike,
  ProviderHttp,
  ProviderHttpError,
} from '../../src/main/library/providers/http/provider-http'
import { createSourceCooldown } from '../../src/shared/douban/frodo'
import {
  defaultDoubanQuery,
  normalizeDoubanQuery,
} from '../../src/shared/douban/query'
import { HttpStatusError, type NetClient } from '../../src/shared/net/client'
import { tempTree } from '../library/engine/helpers'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/douban/${name}.json`, 'utf8'))

const REXXAR = 'https://m.douban.com/rexxar/api/v2/'
const FRODO = 'https://frodo.douban.com/api/v2/'

/** 假 NetClient：按主机前缀回复（值或函数，Error 抛出），记录请求 */
function fakeNet(routes: Record<string, unknown>): NetClient & {
  requests: Array<{ url: string; headers: Record<string, string> }>
} {
  const requests: Array<{ url: string; headers: Record<string, string> }> = []
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

describe('豆瓣浏览（库外发现）回退', () => {
  const q = normalizeDoubanQuery({ ...defaultDoubanQuery(), genre: '科幻' })

  it('rexxar 403：同一查询换 frodo 签名地址取，映射成同样的卡片；结果进同一份页缓存', async () => {
    const logs: string[] = []
    const net = fakeNet({
      [REXXAR]: new HttpStatusError(403),
      [FRODO]: fixture('frodo-recommend-movie'),
    })
    const browse = createDoubanBrowse({
      net,
      frodo: true,
      log: l => logs.push(l),
    })
    const page = await browse.page(q, 0)
    expect(page.items.map(i => i.id)).toEqual([
      '37068446',
      '36179101',
      '36246195',
    ])
    expect(page.items[0]).toMatchObject({
      kind: 'movie',
      rate: '7.3',
      year: '2026',
    })
    expect(page.next).toBe(20)
    expect(net.requests.map(r => new URL(r.url).host)).toEqual([
      'm.douban.com',
      'frodo.douban.com',
    ])
    const frodo = new URL(net.requests[1].url)
    expect(frodo.pathname).toBe('/api/v2/movie/recommend')
    expect(frodo.searchParams.get('tags')).toBe('科幻')
    expect(frodo.searchParams.get('_sig')).toBeTruthy()
    expect(net.requests[1].headers['User-Agent']).toMatch(/com\.douban\.frodo/)
    expect(logs).toEqual([expect.stringContaining('HTTP 403')])
    // 同一个查询：命中缓存，两个源都不再请求
    await browse.page(q, 0)
    expect(net.requests).toHaveLength(2)
  })

  it('rexxar 整页为空（风控常见的 200 + 空列表）也走 frodo', async () => {
    const net = fakeNet({
      [REXXAR]: { items: [], total: 0 },
      [FRODO]: fixture('frodo-recommend-movie'),
    })
    const page = await createDoubanBrowse({ net, frodo: true }).page(q, 0)
    expect(page.items).toHaveLength(3)
  })

  it('两个都失败：抛 rexxar 的原错误，不缓存；关掉开关只请求 rexxar', async () => {
    const net = fakeNet({
      [REXXAR]: new HttpStatusError(418),
      [FRODO]: new HttpStatusError(400),
    })
    const browse = createDoubanBrowse({ net, frodo: true })
    await expect(browse.page(q, 0)).rejects.toMatchObject({ status: 418 })
    await expect(browse.page(q, 0)).rejects.toMatchObject({ status: 418 })
    expect(net.requests).toHaveLength(4)

    const off = fakeNet({ [REXXAR]: new HttpStatusError(403) })
    await expect(
      createDoubanBrowse({ net: off, frodo: false }).page(q, 0)
    ).rejects.toMatchObject({ status: 403 })
    expect(off.requests).toHaveLength(1)
  })

  it('rexxar 熔断后（同一个熔断器）不再请求 rexxar，直接 frodo', async () => {
    const net = fakeNet({
      [REXXAR]: new HttpStatusError(403),
      [FRODO]: fixture('frodo-recommend-movie'),
    })
    const browse = createDoubanBrowse({ net, frodo: true })
    for (let start = 0; start < 60; start += 20) await browse.page(q, start)
    expect(net.requests.filter(r => r.url.startsWith(REXXAR))).toHaveLength(3)
    await browse.page(q, 60)
    expect(net.requests.filter(r => r.url.startsWith(REXXAR))).toHaveLength(3)
    expect(net.requests.filter(r => r.url.startsWith(FRODO))).toHaveLength(4)
  })
})

/** 假 fetch：按主机前缀回复 { status, body }，记录请求时间 */
function fakeFetch(
  routes: Record<string, () => { status: number; body: unknown }>,
  clock: { now: () => number }
): FetchLike & { calls: Array<{ url: string; at: number }> } {
  const calls: Array<{ url: string; at: number }> = []
  const fetch: FetchLike = async url => {
    calls.push({ url, at: clock.now() })
    const key = Object.keys(routes).find(prefix => url.startsWith(prefix))
    const { status, body } = key ? routes[key]() : { status: 404, body: null }
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return { status, headers: { get: () => null }, text: async () => text }
  }
  return Object.assign(fetch, { calls })
}

/** 测试用的低速 HTTP 层：假时钟、内存缓存 */
interface SlowHttp {
  clock: { t: number; now: () => number; sleep: (ms: number) => Promise<void> }
  cache: MemoryResponseCache
  http: ProviderHttp
}

function slowHttp(fetch: FetchLike): SlowHttp {
  const clock: SlowHttp['clock'] = {
    t: 0,
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.t += ms
      await Promise.resolve()
    },
  }
  const cache = new MemoryResponseCache()
  const http = new ProviderHttp({
    fetch: ((url, init) => fetch(url, init)) as FetchLike,
    cache,
    rps: 0.5,
    burst: 1,
    concurrency: 1,
    maxRetries: 0,
    clock,
  })
  return { clock, cache, http }
}

describe('豆瓣补类型回退', () => {
  const q: DoubanGenreQuery = { title: '让子弹飞', year: 2010, kind: 'movie' }

  function setup(
    rexxar: () => { status: number; body: unknown },
    frodo = true
  ): {
    fetch: ReturnType<typeof fakeFetch>
    http: ProviderHttp
    lookup: DoubanGenreLookup
    logs: string[]
    cache: MemoryResponseCache
  } {
    const routes = {
      [REXXAR]: rexxar,
      [FRODO]: () => ({ status: 200, body: fixture('frodo-search-movie') }),
    }
    let now = (): number => 0
    const fetch = fakeFetch(routes, { now: () => now() })
    const { clock, cache, http } = slowHttp(fetch)
    now = clock.now
    const logs: string[] = []
    const lookup = new DoubanGenreLookup(http, cache, clock.now, {
      frodo,
      cooldown: createSourceCooldown(600_000, clock.now),
      log: m => logs.push(m),
    })
    return { fetch, http, lookup, logs, cache }
  }

  it('rexxar 418：走 frodo 拿到类型；frodo 也受同一个令牌桶约束（隔 2 秒）', async () => {
    const { fetch, http, lookup, logs } = setup(() => ({
      status: 418,
      body: '',
    }))
    const found = await lookup.lookup(q)
    expect(found?.genres).toEqual(['剧情', '喜剧', '动作', '西部'])
    expect(found?.countries).toEqual(['CN', 'HK'])
    expect(fetch.calls.map(c => new URL(c.url).host)).toEqual([
      'm.douban.com',
      'frodo.douban.com',
    ])
    expect(fetch.calls[1].at - fetch.calls[0].at).toBeGreaterThanOrEqual(2000)
    expect(http.stats.requests).toBe(2)
    expect(logs[0]).toMatch(/豆瓣补类型：rexxar 失败（HTTP 418）.*改走 frodo/)
  })

  it('缓存不分来源：frodo 的结果写在同一个查询键下，下次不发请求', async () => {
    const { fetch, lookup, cache } = setup(() => ({ status: 403, body: '' }))
    await lookup.lookup(q)
    expect(lookup.cached(q)).toBe(true)
    expect(cache.get(DoubanGenreLookup.cacheKey(q))?.body).toContain('3742360')
    expect((await lookup.lookup(q))?.genres).toContain('喜剧')
    expect(fetch.calls).toHaveLength(2)
  })

  it('rexxar 空结果 / 验证页 HTML 都回退；空结果不先占住缓存', async () => {
    const empty = setup(() => ({ status: 200, body: { items: [] } }))
    expect((await empty.lookup.lookup(q))?.genres).toContain('喜剧')
    expect(empty.lookup.cached(q)).toBe(true)

    const html = setup(() => ({
      status: 200,
      body: '<html>sec.douban.com</html>',
    }))
    expect((await html.lookup.lookup(q))?.genres).toContain('喜剧')
    expect(html.logs[0]).toContain('验证页')
  })

  it('两个都失败：抛 rexxar 的原错误（genre-fill 据此停下），不缓存', async () => {
    const routes = {
      [REXXAR]: () => ({ status: 418, body: '' }),
      [FRODO]: () => ({ status: 400, body: { code: 996 } }),
    }
    let now = (): number => 0
    const fetch = fakeFetch(routes, { now: () => now() })
    const { clock, cache, http } = slowHttp(fetch)
    now = clock.now
    const lookup = new DoubanGenreLookup(http, cache, clock.now, {
      frodo: true,
    })
    const error = await lookup.lookup(q).catch(e => e)
    expect(error).toBeInstanceOf(ProviderHttpError)
    expect(error.status).toBe(418)
    expect(lookup.cached(q)).toBe(false)
  })

  it('关掉开关：只走 rexxar，空结果照旧缓存 30 天', async () => {
    const { fetch, lookup } = setup(
      () => ({ status: 200, body: { items: [] } }),
      false
    )
    expect(await lookup.lookup(q)).toBeNull()
    expect(lookup.cached(q)).toBe(true)
    expect(fetch.calls).toHaveLength(1)
  })

  it('createGenreFill：rexxar 被拦时经 frodo 把类型补进片库（真实令牌桶，约 2 秒）', async () => {
    const tree = tempTree()
    const service = new LibraryService({ dbPath: ':memory:', watch: false })
    try {
      await service.start()
      tree.write('让子弹飞.2010.mkv')
      const automation = { identify: false, watch: false } as const
      await service.addLibrary({ root: tree.root, kind: 'movie', automation })
      await service.queue.idle()
      const ids = (
        service.db.prepare('SELECT id FROM media_items').all() as Array<{
          id: number
        }>
      ).map(r => Number(r.id))
      const logs: string[] = []
      const fetch = fakeFetch(
        {
          [REXXAR]: () => ({ status: 403, body: '' }),
          [FRODO]: () => ({ status: 200, body: fixture('frodo-search-movie') }),
        },
        { now: Date.now }
      )
      const fill = createGenreFill({
        db: service.db,
        fetch,
        cache: new MemoryResponseCache(),
        log: m => logs.push(m),
        frodo: true,
      })
      expect(await fill(ids)).toEqual(ids)
      const row = service.db
        .prepare('SELECT genres FROM media_items WHERE id = ?')
        .get(ids[0]) as { genres: string }
      expect(JSON.parse(row.genres)).toEqual(['剧情', '喜剧', '动作', '西部'])
      expect(logs).toEqual([expect.stringContaining('改走 frodo')])
    } finally {
      await service.close()
      tree.cleanup()
    }
  }, 15_000)
})
