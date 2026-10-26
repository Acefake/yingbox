/**
 * 唯一出网实现：SSRF 校验、手动跟随重定向（每一跳都校验）、超时、大小上限、
 * 同 URL 并发去重、短时缓存。
 *
 * 底层 fetch 与 DNS 解析由宿主注入：引擎注入 Electron `net.fetch`（Chromium 网络栈），
 * 主进程的 http 域（影视在用）注入 Node fetch。本文件不 import 任何 node / electron 模块。
 */
import { type LookupAll, assertPublicTarget } from './guard'
import { withExplicitReferrer } from './referrer'

/** 宿主提供的 fetch（WHATWG 形状，必须支持 `redirect: 'manual'` 返回 3xx 原响应）。 */
export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>

/** 一次请求的选项。 */
export interface NetRequest {
  method?: 'GET' | 'POST' | 'HEAD'
  headers?: Record<string, string>
  body?: string
  /** 单次请求超时（含所有重定向），默认 30 秒 */
  timeoutMs?: number
  /** 响应体上限，默认 16MB */
  maxBytes?: number
  /** 自定义每一跳的目标校验；默认只允许公网 http/https。返回 false 即拒绝。 */
  allow?: (url: URL) => boolean
  /** 外部取消 */
  signal?: AbortSignal
}

/** 读完的响应。 */
export interface NetResponse {
  status: number
  /** 跟随重定向后的最终地址 */
  url: string
  headers: Headers
  body: Uint8Array
}

/** 未读响应体的响应（流式下载用）。 */
export interface OpenResponse {
  response: Response
  url: string
}

/** 网络客户端。 */
export interface NetClient {
  /** 发出请求并跟随安全重定向，返回未读的响应。调用方负责读完或取消 body。 */
  open(url: string, req?: NetRequest): Promise<OpenResponse>
  /** 发出请求并读完响应体（受 maxBytes 限制）。 */
  request(url: string, req?: NetRequest): Promise<NetResponse>
  /** GET 文本：同 URL 并发去重，ttlMs > 0 时缓存。非 2xx 抛错。 */
  getText(
    url: string,
    req?: Omit<NetRequest, 'method' | 'body'> & { ttlMs?: number }
  ): Promise<{ text: string; url: string; status: number }>
  /** GET JSON：同 getText，再解析 JSON。 */
  getJson<T = unknown>(
    url: string,
    req?: Omit<NetRequest, 'method' | 'body'> & { ttlMs?: number }
  ): Promise<T>
}

/** 创建客户端时的依赖。 */
export interface NetDeps {
  fetch: FetchImpl
  lookup: LookupAll
  /** 当前时间（测试注入） */
  now?: () => number
  /** 缓存条目上限，默认 200 */
  cacheSize?: number
  /**
   * 每一跳的目标校验，默认 assertPublicTarget（只允许公网 http/https）。
   * 只有显式配置了内网放行名单的宿主（独立服务的播放代理）才替换它。
   */
  guard?: (url: string, lookup: LookupAll) => Promise<URL>
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** HTTP 非 2xx。 */
export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
    this.name = 'HttpStatusError'
  }
}

/** 读响应体，超过上限立即中止。 */
export async function readBody(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new Error('响应内容超过大小限制')
  }
  if (!response.body) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error('响应内容超过大小限制')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** 创建网络客户端。 */
export function createNetClient(deps: NetDeps): NetClient {
  const now = deps.now ?? Date.now
  const cacheSize = deps.cacheSize ?? 200
  const guard = deps.guard ?? assertPublicTarget
  const inflight = new Map<
    string,
    Promise<{ text: string; url: string; status: number }>
  >()
  const cache = new Map<
    string,
    { at: number; value: { text: string; url: string; status: number } }
  >()

  async function open(
    url: string,
    req: NetRequest = {}
  ): Promise<OpenResponse> {
    const timeout = AbortSignal.timeout(req.timeoutMs ?? 30000)
    const signal = req.signal ? AbortSignal.any([timeout, req.signal]) : timeout
    let current = url
    let method = req.method ?? 'GET'
    let body = req.body
    const headers = { 'User-Agent': DEFAULT_UA, ...req.headers }
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await guard(current, deps.lookup)
      if (req.allow && !req.allow(target))
        throw new Error(`不允许访问：${target.host}`)
      const response = await deps.fetch(
        current,
        withExplicitReferrer({
          method,
          headers,
          body,
          signal,
          redirect: 'manual',
        })
      )
      if (!REDIRECTS.has(response.status)) return { response, url: current }
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => {})
      if (!location) throw new Error('重定向缺少 Location')
      current = new URL(location, current).toString()
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method === 'POST')
      ) {
        method = 'GET'
        body = undefined
      }
    }
    throw new Error('重定向次数过多')
  }

  async function request(
    url: string,
    req: NetRequest = {}
  ): Promise<NetResponse> {
    const { response, url: finalUrl } = await open(url, req)
    const body =
      req.method === 'HEAD'
        ? new Uint8Array(0)
        : await readBody(response, req.maxBytes ?? 16 * 1024 * 1024)
    return {
      status: response.status,
      url: finalUrl,
      headers: response.headers,
      body,
    }
  }

  async function fetchText(
    url: string,
    req: NetRequest
  ): Promise<{ text: string; url: string; status: number }> {
    const res = await request(url, { ...req, method: 'GET' })
    if (res.status < 200 || res.status >= 300)
      throw new HttpStatusError(res.status)
    return {
      text: new TextDecoder().decode(res.body),
      url: res.url,
      status: res.status,
    }
  }

  async function getText(
    url: string,
    req: Omit<NetRequest, 'method' | 'body'> & { ttlMs?: number } = {}
  ): Promise<{ text: string; url: string; status: number }> {
    const { ttlMs = 0, ...rest } = req
    const key = `${url}\n${JSON.stringify(rest.headers ?? {})}`
    const hit = cache.get(key)
    if (hit && now() - hit.at < ttlMs) return hit.value
    const pending = inflight.get(key)
    if (pending) return pending
    const task = fetchText(url, rest).then(value => {
      if (ttlMs > 0) {
        if (cache.size >= cacheSize) cache.delete(cache.keys().next().value!)
        cache.set(key, { at: now(), value })
      }
      return value
    })
    inflight.set(key, task)
    try {
      return await task
    } finally {
      inflight.delete(key)
    }
  }

  return {
    open,
    request,
    getText,
    async getJson<T>(
      url: string,
      req?: Omit<NetRequest, 'method' | 'body'> & { ttlMs?: number }
    ): Promise<T> {
      const { text } = await getText(url, req)
      return JSON.parse(text) as T
    },
  }
}
