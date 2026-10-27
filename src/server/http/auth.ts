/**
 * 访问令牌鉴权（可选加固）：只有设置了 YINGBOX_SERVER_TOKEN 才开启；没设时不鉴权，所有请求直接放行。
 *
 * 开启时 API 与媒体都要令牌，只有健康检查、登录与网页静态文件公开。令牌来源（任一）：
 * - `Authorization: Bearer <token>`：脚本 / 其它客户端；
 * - Cookie `yingbox_token`：网页端。登录（POST /api/session，或打开带 ?token= 的地址）后由服务写入，
 *   HttpOnly + SameSite=Strict，<img> / <video> / EventSource 自动带上，令牌不出现在页面脚本和资源地址里。
 * 比较用定长哈希 + timingSafeEqual，不泄露长度与前缀。
 * 跨站写请求：带 Origin 且与配置的公网源（或请求源）不一致的非 GET 请求直接拒绝（SameSite 之外再挡一层）。
 */
import { createHash, timingSafeEqual } from 'node:crypto'

/** Cookie 名。 */
export const TOKEN_COOKIE = 'yingbox_token'

/** 一年。 */
const COOKIE_MAX_AGE = 365 * 24 * 3600

const digest = (value: string): Buffer =>
  createHash('sha256').update(value).digest()

/** 从 Cookie 头里取一个值。 */
export function readCookie(
  header: string | null,
  name: string
): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim())
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

/** 鉴权器。 */
export interface Auth {
  /** 是否开启鉴权（设置了访问令牌）。 */
  readonly required: boolean
  /** 候选令牌是否正确；没开启鉴权时恒为 false（没有令牌可比）。 */
  matches(candidate: string | undefined | null): boolean
  /** 请求是否放行：没开启鉴权时恒为 true，否则看是否带了正确的令牌（Bearer 或 Cookie）。 */
  check(request: Request): boolean
  /** 写入令牌的 Set-Cookie 值。 */
  loginCookie(request?: Request): string
  /** 清除令牌的 Set-Cookie 值。 */
  logoutCookie(request?: Request): string
}

/** 创建鉴权器；token 为 null 时不鉴权。 */
export function createAuth(token: string | null, publicOrigin?: string): Auth {
  const secure = (request?: Request): string =>
    (publicOrigin
      ? new URL(publicOrigin).protocol
      : request && new URL(request.url).protocol) === 'https:'
      ? '; Secure'
      : ''
  const expected = token ? digest(token) : null
  const matches = (candidate: string | undefined | null): boolean =>
    Boolean(expected && candidate) &&
    timingSafeEqual(digest(candidate!), expected!)
  return {
    required: expected !== null,
    matches,
    check(request) {
      if (!expected) return true
      const header = request.headers.get('authorization') ?? ''
      const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]
      return (
        matches(bearer) ||
        matches(readCookie(request.headers.get('cookie'), TOKEN_COOKIE))
      )
    },
    loginCookie: request =>
      `${TOKEN_COOKIE}=${encodeURIComponent(token ?? '')}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}${secure(request)}`,
    logoutCookie: request =>
      `${TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure(request)}`,
  }
}

/** 非 GET / HEAD 请求校验完整源；只信任显式公网配置，不采用转发头。 */
export function sameOrigin(request: Request, publicOrigin?: string): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    const url = new URL(request.url)
    const expected =
      publicOrigin ??
      new URL(`${url.protocol}//${request.headers.get('host') ?? url.host}`)
        .origin
    return new URL(origin).origin === origin && origin === expected
  } catch {
    return false
  }
}
