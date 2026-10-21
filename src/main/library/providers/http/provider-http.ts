/**
 * 元数据源统一 HTTP 层：限速、并发、重试、在途去重与响应缓存。
 *
 * 一次 getJson 的路径：
 *   新鲜缓存 → 直接返回；
 *   同 key 已在途 → 共用同一个 Promise；
 *   否则 占并发名额 → 取令牌 → 请求（过期缓存带 If-None-Match）→
 *     200 写缓存 / 304 续期 / 404 记空结果 / 429 按 Retry-After 全局冷却后重试 /
 *     5xx 与网络错误指数退避重试 / 401、403 立即失败。
 *
 * getText 取 HTML 等纯文本（番号站点刮削用）：不缓存、不去重，401 / 403 当作普通失败而不是令牌错误。
 *
 * fetch 由调用方注入：引擎进程里用 Electron net.fetch（走系统代理），测试用假 fetch。
 */
import type { CacheEntry, ResponseCache } from './provider-cache'
import { type Clock, Semaphore, TokenBucket, realClock } from './rate-limiter'

/** 注入的 fetch：只用到标准 fetch 的这一小部分。 */
export type FetchLike = (
  url: string,
  init: {
    headers: Record<string, string>
    signal?: AbortSignal
    /** 缺省 GET；番号站点的站内搜索 / JSON 接口用 POST。 */
    method?: 'GET' | 'POST'
    body?: string
    /** 缺省 follow；只有领取 Cookie（getCookies）用 manual，要读 302 响应自己的 Set-Cookie。 */
    redirect?: 'follow' | 'manual'
  }
) => Promise<{
  status: number
  headers: {
    get(name: string): string | null
    /** 标准 Headers 有；没有时按 get('set-cookie') 退化（多个 Cookie 会被逗号拼在一起）。 */
    getSetCookie?(): string[]
  }
  text(): Promise<string>
  /** 有就用它按页面声明的字符集解码（EUC-JP / Shift_JIS 的老站）；测试里的假 fetch 可以没有。 */
  arrayBuffer?(): Promise<ArrayBuffer>
}>

/** 认证失败：令牌缺失或无效。不重试，识别任务据此直接失败并提示用户。 */
export class ProviderAuthError extends Error {
  override name = 'ProviderAuthError'
}

/** 请求最终失败（重试用尽或不可重试的状态码）。 */
export class ProviderHttpError extends Error {
  override name = 'ProviderHttpError'
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

/** HTTP 层参数。 */
export interface ProviderHttpOptions {
  fetch: FetchLike
  cache?: ResponseCache
  /** 每秒请求数，默认 20。 */
  rps?: number
  /** 令牌桶容量，默认等于 rps。 */
  burst?: number
  /** 同时在途的请求数，默认 8。 */
  concurrency?: number
  /** 失败后最多再试几次，默认 4。 */
  maxRetries?: number
  /** 第一次重试的基础等待，默认 500 ms，之后翻倍（带抖动）。 */
  baseDelayMs?: number
  /** 没有 Retry-After 时 429 的等待，默认 2 s。 */
  default429Ms?: number
  /** 单次请求超时，默认 15 s。 */
  timeoutMs?: number
  clock?: Clock
  /** 随机数（抖动），测试注入。 */
  random?: () => number
}

/** 一次 JSON 请求。 */
export interface JsonRequest {
  url: string
  headers?: Record<string, string>
  /** 缓存键；缺省不缓存（也不去重）。不要把令牌放进键里。 */
  cacheKey?: string
  /** 根据响应体决定缓存多久（毫秒）。 */
  ttl?: (body: unknown) => number
  /** 404 结果缓存多久，默认 1 天。 */
  notFoundTtl?: number
  signal?: AbortSignal
}

/** 一次纯文本请求（HTML 页面）。不缓存；调用方自己缓存解析后的结果。 */
export interface TextRequest {
  url: string
  headers?: Record<string, string>
  signal?: AbortSignal
  /** 缺省：有 body 为 POST，否则 GET。POST 只用于幂等的检索（失败重试是安全的）。 */
  method?: 'GET' | 'POST'
  /** 请求体（表单、JSON 或 GraphQL 查询字符串，Content-Type 由调用方放进 headers）。 */
  body?: string
}

/** 实际方法：显式给了用显式的，否则有请求体就是 POST。 */
export function methodOf(
  request: Pick<TextRequest, 'method' | 'body'>
): 'GET' | 'POST' {
  return request.method ?? (request.body !== undefined ? 'POST' : 'GET')
}

/**
 * 响应体的字符集：先看 Content-Type，再看页面前 2 KB 里的 <meta charset> / http-equiv；都没有按 UTF-8。
 * 只认得到的名字才返回（TextDecoder 不认识的字符集退回 UTF-8）。
 */
export function sniffCharset(
  contentType: string | null,
  head: Uint8Array
): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1]
  const fromMeta =
    fromHeader ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(
      new TextDecoder('latin1').decode(head.subarray(0, 2048))
    )?.[1]
  const label = fromMeta?.toLowerCase() ?? 'utf-8'
  try {
    return new TextDecoder(label).encoding
  } catch {
    return 'utf-8'
  }
}

/** 按字符集解码响应体（TEXT 请求用；JSON 接口固定 UTF-8）。 */
async function readText(
  response: Awaited<ReturnType<FetchLike>>
): Promise<string> {
  if (!response.arrayBuffer) return response.text()
  const bytes = new Uint8Array(await response.arrayBuffer())
  const charset = sniffCharset(response.headers.get('content-type'), bytes)
  return new TextDecoder(charset).decode(bytes)
}

/** send 的解码方式：JSON 解析，或原样返回文本。 */
interface Decoder {
  decode: (text: string) => unknown
  /** 401 / 403 是否按令牌错误处理（JSON API 是；网页站点的 403 多半是防护拦截）。 */
  authErrors: boolean
  /** 按页面声明的字符集解码（网页是；JSON 接口固定 UTF-8）。 */
  sniffCharset?: boolean
}

const JSON_DECODER: Decoder = { decode: JSON.parse, authErrors: true }
const TEXT_DECODER: Decoder = {
  decode: text => text,
  authErrors: false,
  sniffCharset: true,
}

/** 统计（基准与调试用）。 */
export interface ProviderHttpStats {
  requests: number
  cacheHits: number
  notModified: number
  deduped: number
  retries: number
  throttled: number
}

const DAY = 86_400_000

/** 解析 Retry-After：秒数或 HTTP 日期，返回毫秒；无法解析返回 undefined。 */
export function parseRetryAfter(
  value: string | null,
  now: number
): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}

/** 带限速、重试、缓存与去重的 JSON 客户端。 */
export class ProviderHttp {
  readonly stats: ProviderHttpStats = {
    requests: 0,
    cacheHits: 0,
    notModified: 0,
    deduped: 0,
    retries: 0,
    throttled: 0,
  }
  private readonly bucket: TokenBucket
  private readonly slots: Semaphore
  private readonly inflight = new Map<string, Promise<unknown>>()
  private readonly clock: Clock
  private readonly random: () => number
  private readonly maxRetries: number
  private readonly baseDelayMs: number
  private readonly default429Ms: number
  private readonly timeoutMs: number

  constructor(private readonly options: ProviderHttpOptions) {
    this.clock = options.clock ?? realClock
    this.random = options.random ?? Math.random
    const rps = options.rps ?? 20
    this.bucket = new TokenBucket(rps, options.burst ?? rps, this.clock)
    this.slots = new Semaphore(options.concurrency ?? 8)
    this.maxRetries = options.maxRetries ?? 4
    this.baseDelayMs = options.baseDelayMs ?? 500
    this.default429Ms = options.default429Ms ?? 2000
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  /** 取 JSON；404 返回 null。 */
  async getJson<T>(request: JsonRequest): Promise<T | null> {
    const key = request.cacheKey
    const cached = key ? this.options.cache?.get(key) : undefined
    if (cached && cached.expiresAt > this.clock.now()) {
      this.stats.cacheHits++
      return JSON.parse(cached.body) as T | null
    }
    if (!key) {
      return (await this.send(request, undefined, JSON_DECODER)) as T | null
    }
    const pending = this.inflight.get(key)
    if (pending) {
      this.stats.deduped++
      return (await pending) as T | null
    }
    const promise = this.send(request, cached, JSON_DECODER).finally(() =>
      this.inflight.delete(key)
    )
    this.inflight.set(key, promise)
    return (await promise) as T | null
  }

  /** 取纯文本（HTML）；404 返回 null。限速、并发、重试与 getJson 相同。 */
  async getText(request: TextRequest): Promise<string | null> {
    return (await this.send(request, undefined, TEXT_DECODER)) as string | null
  }

  /**
   * 发一次不跟随重定向的 GET，返回响应下发的 Cookie（`name=value`，去掉属性）。
   * 给需要先领会话的站点用（如 GIGA 的年龄确认入口在 302 上下发 Cookie）；同样受并发与限速约束，不重试。
   */
  async getCookies(request: {
    url: string
    headers?: Record<string, string>
    signal?: AbortSignal
  }): Promise<string[]> {
    const { signal } = request
    const release = await this.slots.acquire()
    try {
      await this.bucket.acquire(signal)
      this.stats.requests++
      const timeout = AbortSignal.timeout(this.timeoutMs)
      const response = await this.options.fetch(request.url, {
        headers: { ...request.headers },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        redirect: 'manual',
      })
      await response.text().catch(() => '')
      const raw =
        response.headers.getSetCookie?.() ??
        (response.headers.get('set-cookie') ?? '')
          .split(/,(?=\s*[^;,=\s]+=)/)
          .filter(Boolean)
      return raw
        .map(line => line.split(';')[0]?.trim() ?? '')
        .filter(pair => pair.includes('='))
    } catch (error) {
      if (signal?.aborted) throw error
      throw new ProviderHttpError(
        `请求失败：${(error as Error).message || String(error)}`
      )
    } finally {
      release()
    }
  }

  /** 发请求（含重试），处理缓存写回。 */
  private async send(
    request: JsonRequest & Pick<TextRequest, 'method' | 'body'>,
    stale: CacheEntry | undefined,
    decoder: Decoder
  ): Promise<unknown> {
    const { signal } = request
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted()
      let status: number
      let text = ''
      let headers: { get(name: string): string | null }
      const release = await this.slots.acquire()
      try {
        await this.bucket.acquire(signal)
        this.stats.requests++
        const timeout = AbortSignal.timeout(this.timeoutMs)
        const response = await this.options.fetch(request.url, {
          headers: {
            Accept: 'application/json',
            ...request.headers,
            ...(stale?.etag ? { 'If-None-Match': stale.etag } : {}),
          },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          ...(methodOf(request) === 'POST'
            ? { method: 'POST' as const, body: request.body ?? '' }
            : {}),
        })
        status = response.status
        headers = response.headers
        // 错误响应也读完，避免连接被未消费的响应体占住
        text = decoder.sniffCharset
          ? await readText(response)
          : await response.text()
      } catch (error) {
        release()
        if (signal?.aborted) throw error
        // 网络错误 / 超时：指数退避重试
        if (attempt >= this.maxRetries) {
          throw new ProviderHttpError(
            `请求失败：${(error as Error).message || String(error)}`
          )
        }
        await this.backoff(attempt, signal)
        continue
      }
      release()

      const now = this.clock.now()
      if (status === 200) {
        const body = decoder.decode(text)
        if (request.cacheKey && this.options.cache) {
          this.options.cache.set(
            request.cacheKey,
            {
              body: text,
              etag: headers.get('etag'),
              expiresAt: now + (request.ttl?.(body) ?? DAY),
            },
            now
          )
        }
        return body
      }
      if (status === 304 && stale) {
        this.stats.notModified++
        const body = decoder.decode(stale.body)
        this.options.cache?.touch(
          request.cacheKey!,
          now + (request.ttl?.(body) ?? DAY),
          now
        )
        return body
      }
      if (status === 404) {
        if (request.cacheKey && this.options.cache) {
          this.options.cache.set(
            request.cacheKey,
            {
              body: 'null',
              etag: null,
              expiresAt: now + (request.notFoundTtl ?? DAY),
            },
            now
          )
        }
        return null
      }
      if ((status === 401 || status === 403) && decoder.authErrors) {
        throw new ProviderAuthError(
          `元数据源拒绝访问（HTTP ${status}），请检查 API 令牌`
        )
      }
      const retriable = status === 429 || status >= 500
      if (!retriable || attempt >= this.maxRetries) {
        throw new ProviderHttpError(`元数据源返回 HTTP ${status}`, status)
      }
      if (status === 429) {
        this.stats.throttled++
        const wait =
          parseRetryAfter(headers.get('retry-after'), now) ?? this.default429Ms
        // 冷却对所有请求生效：继续猛发只会被继续 429
        this.bucket.pauseUntil(now + wait)
        this.stats.retries++
        continue
      }
      await this.backoff(attempt, signal)
    }
  }

  private async backoff(attempt: number, signal?: AbortSignal): Promise<void> {
    this.stats.retries++
    const base = this.baseDelayMs * 2 ** attempt
    // 0.5–1.0 倍抖动，避免一批失败的请求同时重试
    await this.clock.sleep(base * (0.5 + this.random() / 2), signal)
  }
}
