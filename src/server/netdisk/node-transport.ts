/**
 * 115 传输层的服务端实现（对应桌面端 session-transport.ts）：Node fetch（undici）+ 持久化 Cookie 罐（cookie-jar.ts）。
 *
 * - 只发 115.com 及其子域的请求；重定向手动跟（最多 {@link MAX_REDIRECTS} 跳），跳出 115 域一律拦下，
 *   相当于桌面端分区上的公网守卫：请求不会被 115 的响应引到内网或别的站点；
 * - Referer / UA 按 transport.ts 的约定补上（Node 不限制这两个头，直接写在请求上）；
 * - Cookie 头由罐子按域 / 路径挑出，调用方传入的 Cookie 头一律丢掉；响应的 Set-Cookie 写回罐子。
 */
import { Pan115Error } from '../../main/pan115/errors'
import type { FetchLike } from '../../main/pan115/http'
import {
  type Pan115Transport,
  is115Url,
  with115Init,
} from '../../main/pan115/transport'
import type { CookieJar } from './cookie-jar'

/** 最多跟几跳重定向 */
export const MAX_REDIRECTS = 5
const REDIRECTS = new Set([301, 302, 303, 307, 308])

/** 服务端传输层；clear 清空罐子 */
export interface NodeTransport extends Pan115Transport {
  clear(): Promise<void>
}

/** 依赖 */
export interface NodeTransportDeps {
  jar: CookieJar
  /** 底层 fetch（缺省为全局 fetch，即 undici）；测试注入假实现 */
  fetch?: FetchLike
  /** 写登录 Cookie 用的源（测试用 http 回显时传 http://115.com） */
  origin?: string
}

/** 读响应的全部 Set-Cookie（undici 的 getSetCookie；假实现没有时退回单个头） */
function setCookiesOf(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[]
  }
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

/** 建服务端传输层 */
export function createNodeTransport(deps: NodeTransportDeps): NodeTransport {
  const send = deps.fetch ?? ((url, init) => fetch(url, init))
  const { jar } = deps

  async function request(
    url: string,
    init: RequestInit = {}
  ): Promise<Response> {
    if (!is115Url(url)) throw new Pan115Error('只允许请求 115 的地址')
    let current = url
    let currentInit = init
    for (let hop = 0; ; hop++) {
      const prepared = with115Init(current, currentInit)
      const headers = new Headers(prepared.headers)
      headers.delete('cookie')
      const cookie = jar.header(current)
      if (cookie) headers.set('Cookie', cookie)
      const response = await send(current, {
        ...prepared,
        headers,
        redirect: 'manual',
      })
      jar.store(current, setCookiesOf(response))
      const location = response.headers.get('location')
      if (!REDIRECTS.has(response.status) || !location) return response
      if (hop >= MAX_REDIRECTS) throw new Pan115Error('115 重定向次数过多')
      const next = new URL(location, current).toString()
      if (!is115Url(next))
        throw new Pan115Error('115 重定向到了站外地址，已拦截')
      const method = (currentInit.method ?? 'GET').toUpperCase()
      // 303，以及 301 / 302 的 POST，按浏览器规则用 GET 跟过去、不带请求体
      if (
        response.status === 303 ||
        (method === 'POST' && response.status <= 302)
      )
        currentInit = { ...currentInit, method: 'GET', body: undefined }
      current = next
    }
  }

  return {
    fetch: request,
    async useCookie(cookie) {
      if (jar.baseCookie() === cookie) return
      jar.replace(cookie, deps.origin)
    },
    async clear() {
      jar.replace(null, deps.origin)
    },
  }
}
