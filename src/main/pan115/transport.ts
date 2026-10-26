/**
 * 115 请求的传输层约定（纯逻辑，不依赖 Electron）。
 *
 * 115 请求不靠手写 Cookie 头，由独立分区带上；Referer / UA 只给 115 域补。Electron 37 实测（scripts/pan115-selftest）：
 * - Cookie 写进分区的 Cookie 罐（{@link cookieDetails}），credentials: 'include' 时随请求发出；
 * - 手写 Referer 必须配 referrerPolicy: 'unsafe-url'，否则网络服务判为非法引用、整个请求以
 *   net::ERR_BLOCKED_BY_CLIENT 取消；onBeforeSendHeaders 里加的 Referer 会被丢掉，所以 Referer 在请求上带（{@link with115Init}）；
 * - UA 在分区的 onBeforeSendHeaders 里统一覆盖（{@link with115Headers}），请求上也带一份。
 * Electron 实现见 session-transport.ts；单测用假实现。
 */
import { type FetchLike, USER_AGENT } from './http'

/** 115 网页端的 Referer */
export const PAN115_REFERER = 'https://115.com/'

/** onBeforeSendHeaders 的过滤规则：115.com 及其子域 */
export const PAN115_URL_PATTERNS = ['*://115.com/*', '*://*.115.com/*']

/** 115 的传输层：发请求 + 管理分区里的登录 Cookie */
export interface Pan115Transport {
  /** 发 115 域请求（Cookie 来自分区，Referer / UA 由分区补上） */
  fetch: FetchLike
  /** 把一份 "UID=…; CID=…; SEID=…; KID=…" 写进分区，替换原有的；null 为清空 */
  useCookie(cookie: string | null): Promise<void>
}

/** 地址是否属于 115.com（含子域；仿冒域名不算） */
export function is115Url(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === '115.com' || host.endsWith('.115.com')
  } catch {
    return false
  }
}

/**
 * 115 域的请求头补上 Referer 与桌面 UA（覆盖原值，不论大小写）；别的域名原样返回。
 * 例外：调用方给的是 115 客户端 UA（含 115Browser，云下载的客户端接口要）时保留它。
 */
export function with115Headers(
  url: string,
  headers: Record<string, string>
): Record<string, string> {
  if (!is115Url(url)) return headers
  const out: Record<string, string> = {}
  let clientUa = ''
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (lower === 'user-agent' && value.includes('115Browser')) clientUa = value
    if (lower !== 'referer' && lower !== 'user-agent') out[key] = value
  }
  out.Referer = PAN115_REFERER
  out['User-Agent'] = clientUa || USER_AGENT
  return out
}

/**
 * 115 域的请求参数：请求头补 Referer / UA，并设 referrerPolicy: 'unsafe-url' 让 Referer 原样发出；
 * 别的域名原样返回。
 */
export function with115Init(url: string, init: RequestInit = {}): RequestInit {
  if (!is115Url(url)) return init
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((value, key) => (headers[key] = value))
  return {
    ...init,
    headers: with115Headers(url, headers),
    referrerPolicy: 'unsafe-url',
  }
}

/** Cookie 串 → 名值对；跳过空段与没有名字的段 */
export function parseCookieHeader(
  cookie: string
): Array<{ name: string; value: string }> {
  return cookie
    .split(';')
    .map(part => part.trim())
    .filter(part => part.indexOf('=') > 0)
    .map(part => {
      const eq = part.indexOf('=')
      return { name: part.slice(0, eq).trim(), value: part.slice(eq + 1) }
    })
}

/** 写入分区的一条 Cookie（Electron cookies.set 的参数） */
export interface CookieDetails {
  url: string
  domain: string
  path: string
  name: string
  value: string
  secure: boolean
  httpOnly: boolean
}

/**
 * Cookie 串 → 分区 Cookie 写入参数：域 = origin 主机前加点（.115.com），HttpOnly，
 * https 时带 Secure；不设过期时间，只活在内存里，不随分区落盘。
 */
export function cookieDetails(cookie: string, origin: string): CookieDetails[] {
  const domain = `.${new URL(origin).hostname}`
  const secure = origin.startsWith('https:')
  return parseCookieHeader(cookie).map(({ name, value }) => ({
    url: origin,
    domain,
    path: '/',
    name,
    value,
    secure,
    httpOnly: true,
  }))
}
