/**
 * 115 / PanSou / Torznab 请求的公共部分：注入的 fetch 类型、请求头、读 JSON、局域网地址的同主机重定向。
 */
import { Pan115Error } from './errors'

/** 注入的 fetch（主进程用 Electron net.fetch，测试用假实现） */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** 115 网页端常见的桌面 Chrome UA */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/** 单次请求超时（毫秒）；PanSou 聚合多个来源，给得宽一些 */
export const REQUEST_TIMEOUT_MS = 30_000

/** 网络层失败（DNS、拒绝连接、连接被重置），没拿到任何响应 */
export class UnreachableError extends Pan115Error {
  constructor(label: string) {
    super(`${label} 连不上`)
  }
}

/**
 * 发请求（带超时），不看状态码；网络失败、超时转成 {@link Pan115Error}。
 * 超时看自己的计时信号是否已触发，不看错误名（Electron net.fetch 中止时不一定抛 TimeoutError）。
 */
export async function fetchResponse(
  fetch: FetchLike,
  label: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const timer = AbortSignal.timeout(timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, timer]) : timer,
    })
  } catch (error) {
    if (error instanceof Pan115Error) throw error
    if (timer.aborted)
      throw new Pan115Error(`${label} 请求超时`, undefined, true)
    throw new UnreachableError(label)
  }
}

/** HTTP 状态码不是 2xx（status 供调用方判断是否值得重试，例如 5xx） */
export class HttpStatusError extends Pan115Error {
  constructor(
    label: string,
    readonly status: number
  ) {
    super(`${label} 返回 HTTP ${status}`)
  }
}

/** 发请求并读 JSON；HTTP 失败（{@link HttpStatusError}）、超时、非 JSON 都转成 {@link Pan115Error} */
export async function fetchJson(
  fetch: FetchLike,
  label: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<unknown> {
  const response = await fetchResponse(fetch, label, url, init, timeoutMs)
  if (!response.ok) throw new HttpStatusError(label, response.status)
  try {
    return await response.json()
  } catch {
    throw new Pan115Error(`${label} 返回的不是 JSON`)
  }
}

/** 普通对象（否则为空对象），读未知 JSON 用 */
export function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 字符串或数字 → 字符串；其余为空串 */
export function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : ''
}

const MAX_REDIRECTS = 3
const REDIRECTS = new Set([301, 302, 303, 307, 308])

/** 重定向目标是磁力 / 电驴链接（Torznab 下载地址常 302 到 magnet:） */
export function isOfflineScheme(location: string): boolean {
  return /^(magnet:\?|ed2k:\/\/)/i.test(location.trim())
}

/**
 * 用户填的局域网地址（PanSou、Torznab）用的 fetch：不做私网拦截，但重定向手动跟随，只允许同一主机
 * （http → https 升级也算），最多 3 跳；307 / 308 保留方法与请求体，其余一律用 GET 且不带请求体。
 * 跨主机时抛错；跳到 magnet: / ed2k:// 时不再跟，把这个 3xx 响应原样返回（调用方读 Location）。
 * @param label 报错时的名字
 */
export function sameHostFetch(fetch: FetchLike, label: string): FetchLike {
  return async (url, init = {}) => {
    let current = url
    let request: RequestInit = { ...init, redirect: 'manual' }
    for (let hop = 0; ; hop++) {
      const response = await fetch(current, request)
      const location = response.headers.get('location')
      if (!REDIRECTS.has(response.status) || !location) return response
      if (isOfflineScheme(location)) return response
      const next = new URL(location, current)
      if (next.hostname !== new URL(current).hostname)
        throw new Pan115Error(
          `${label} 重定向到别的主机（${next.hostname}），已拦截`
        )
      if (hop >= MAX_REDIRECTS) throw new Pan115Error(`${label} 重定向次数过多`)
      if (response.status !== 307 && response.status !== 308) {
        request = { ...request, method: 'GET', body: undefined }
      }
      current = next.toString()
    }
  }
}
