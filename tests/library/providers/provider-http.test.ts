import { describe, expect, it } from 'vitest'
import { MemoryResponseCache } from '../../../src/main/library/providers/http/provider-cache'
import {
  type FetchLike,
  ProviderAuthError,
  ProviderHttp,
  ProviderHttpError,
  parseRetryAfter,
} from '../../../src/main/library/providers/http/provider-http'
import type { Clock } from '../../../src/main/library/providers/http/rate-limiter'

/** 虚拟时钟：sleep 立即返回并把时间往前拨。令牌桶的等待是串行的，所以拨表是准确的。 */
function virtualClock(): Clock & { t: number } {
  const clock = {
    t: 0,
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.t += ms
      await Promise.resolve()
    },
  }
  return clock
}

type Reply = { status: number; body?: string; headers?: Record<string, string> }

/** 假 fetch：按脚本回复，记录每次请求的时间与请求头。 */
function scriptedFetch(
  reply: (call: number, url: string) => Reply | Error,
  clock?: { now(): number }
): FetchLike & {
  calls: Array<{ url: string; at: number; headers: Record<string, string> }>
} {
  const calls: Array<{
    url: string
    at: number
    headers: Record<string, string>
  }> = []
  const fn = (async (
    url: string,
    init: { headers: Record<string, string> }
  ) => {
    calls.push({ url, at: clock?.now() ?? 0, headers: init.headers })
    const r = reply(calls.length, url)
    if (r instanceof Error) throw r
    const headers = new Map(
      Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
    )
    return {
      status: r.status,
      headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
      text: async () => r.body ?? '',
    }
  }) as FetchLike & { calls: typeof calls }
  fn.calls = calls
  return fn
}

const ok = (
  body: unknown = { ok: true },
  headers?: Record<string, string>
): Reply => ({
  status: 200,
  body: JSON.stringify(body),
  headers,
})

describe('ProviderHttp 限速', () => {
  it('令牌桶：60 个请求、20 rps、突发 20 → 前 20 个立即发出，其余每 50 ms 一个，共约 2 秒', async () => {
    const clock = virtualClock()
    const fetch = scriptedFetch(() => ok(), clock)
    const http = new ProviderHttp({ fetch, rps: 20, concurrency: 100, clock })
    await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        http.getJson({ url: `https://x/${i}` })
      )
    )
    const times = fetch.calls.map(c => c.at)
    expect(times.slice(0, 20).every(t => t === 0)).toBe(true)
    expect(times.at(-1)).toBeCloseTo(2000, 0)
    // 任意 1 秒窗口内不超过 20 + 突发 20 个
    for (const t of times) {
      expect(
        times.filter(x => x >= t && x < t + 1000).length
      ).toBeLessThanOrEqual(40)
    }
  })

  it('并发上限：同时在途的请求不超过 concurrency', async () => {
    let active = 0
    let peak = 0
    const fetch: FetchLike = async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      return {
        status: 200,
        headers: { get: () => null },
        text: async () => '{}',
      }
    }
    const http = new ProviderHttp({ fetch, rps: 10_000, concurrency: 8 })
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        http.getJson({ url: `https://x/${i}` })
      )
    )
    expect(peak).toBe(8)
  })
})

describe('ProviderHttp 重试', () => {
  it('429 按 Retry-After 全局冷却后重试', async () => {
    const clock = virtualClock()
    const fetch = scriptedFetch(
      call =>
        call === 1 ? { status: 429, headers: { 'Retry-After': '3' } } : ok(),
      clock
    )
    const http = new ProviderHttp({ fetch, clock })
    expect(await http.getJson({ url: 'https://x/a' })).toEqual({ ok: true })
    expect(fetch.calls.map(c => c.at)).toEqual([0, 3000])
    expect(http.stats.throttled).toBe(1)
    // 冷却期间发起的新请求也要等到冷却结束
    const later = scriptedFetch(
      call =>
        call === 1 ? { status: 429, headers: { 'Retry-After': '2' } } : ok(),
      clock
    )
    const http2 = new ProviderHttp({ fetch: later, clock, concurrency: 1 })
    const start = clock.now()
    await Promise.all([
      http2.getJson({ url: 'https://x/1' }),
      http2.getJson({ url: 'https://x/2' }),
    ])
    expect(later.calls.slice(1).every(c => c.at >= start + 2000)).toBe(true)
  })

  it('没有 Retry-After 时用默认冷却；HTTP 日期格式也能解析', () => {
    expect(parseRetryAfter('2', 0)).toBe(2000)
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4000)).toBe(6000)
    expect(parseRetryAfter('soon', 0)).toBeUndefined()
  })

  it('网络错误与 5xx 指数退避重试，用尽后抛 ProviderHttpError', async () => {
    const clock = virtualClock()
    const fetch = scriptedFetch(
      call =>
        call === 1
          ? new Error('ECONNRESET')
          : call === 2
            ? { status: 502 }
            : ok(),
      clock
    )
    const http = new ProviderHttp({
      fetch,
      clock,
      baseDelayMs: 100,
      random: () => 1,
    })
    expect(await http.getJson({ url: 'https://x/a' })).toEqual({ ok: true })
    expect(fetch.calls.map(c => c.at)).toEqual([0, 100, 300])

    const down = scriptedFetch(() => ({ status: 503 }), clock)
    const http2 = new ProviderHttp({ fetch: down, clock, maxRetries: 2 })
    await expect(http2.getJson({ url: 'https://x/b' })).rejects.toBeInstanceOf(
      ProviderHttpError
    )
    expect(down.calls).toHaveLength(3)
  })

  it('401 / 403 立即失败、不重试', async () => {
    const fetch = scriptedFetch(() => ({ status: 401 }))
    const http = new ProviderHttp({ fetch })
    await expect(http.getJson({ url: 'https://x/a' })).rejects.toBeInstanceOf(
      ProviderAuthError
    )
    expect(fetch.calls).toHaveLength(1)
  })
})

describe('ProviderHttp 去重与缓存', () => {
  it('同 key 的并发请求只发一次', async () => {
    let resolve!: () => void
    const gate = new Promise<void>(r => (resolve = r))
    let calls = 0
    const fetch: FetchLike = async () => {
      calls++
      await gate
      return {
        status: 200,
        headers: { get: () => null },
        text: async () => '{"n":1}',
      }
    }
    const http = new ProviderHttp({ fetch, cache: new MemoryResponseCache() })
    const all = Promise.all(
      Array.from({ length: 10 }, () =>
        http.getJson({ url: 'https://x/a', cacheKey: 'k' })
      )
    )
    resolve()
    expect(await all).toEqual(Array(10).fill({ n: 1 }))
    expect(calls).toBe(1)
    expect(http.stats.deduped).toBe(9)
  })

  it('新鲜缓存直接命中；过期后带 If-None-Match，304 续期并复用正文', async () => {
    const clock = virtualClock()
    const fetch = scriptedFetch(
      call => (call === 1 ? ok({ v: 1 }, { ETag: '"e1"' }) : { status: 304 }),
      clock
    )
    const cache = new MemoryResponseCache()
    const http = new ProviderHttp({ fetch, cache, clock })
    const req = { url: 'https://x/a', cacheKey: 'k', ttl: () => 1000 }
    expect(await http.getJson(req)).toEqual({ v: 1 })
    expect(await http.getJson(req)).toEqual({ v: 1 })
    expect(fetch.calls).toHaveLength(1)
    expect(http.stats.cacheHits).toBe(1)

    clock.t += 5000
    expect(await http.getJson(req)).toEqual({ v: 1 })
    expect(fetch.calls).toHaveLength(2)
    expect(fetch.calls[1].headers['If-None-Match']).toBe('"e1"')
    expect(http.stats.notModified).toBe(1)
    expect(cache.get('k')!.expiresAt).toBe(clock.t + 1000)
  })

  it('404 返回 null 并缓存（不重复查不存在的条目）', async () => {
    const fetch = scriptedFetch(() => ({ status: 404 }))
    const http = new ProviderHttp({ fetch, cache: new MemoryResponseCache() })
    expect(await http.getJson({ url: 'https://x/a', cacheKey: 'k' })).toBeNull()
    expect(await http.getJson({ url: 'https://x/a', cacheKey: 'k' })).toBeNull()
    expect(fetch.calls).toHaveLength(1)
  })
})
