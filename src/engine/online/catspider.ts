/**
 * CatSpider（XPTV）插件运行时：下载插件源码，注入宿主 API（$fetch、cheerio、CryptoJS…），
 * 调用插件的 getConfig / search / getCards / getTracks / getPlayinfo。
 *
 * 取代原来 Go → Python → Node 子进程的三级调用；插件的网络请求全部经引擎 net，
 * 遇到 Cloudflare 挑战页时请主进程用浏览器代抓（替代原临时文件 + 本机端口发现）。
 */
import type { Cheerio } from 'cheerio'
import CryptoJS from 'crypto-js'
import { constants, privateDecrypt, publicEncrypt } from 'node:crypto'
import type { NetClient } from '../../shared/net/client'
import { classifyPage } from '../../shared/net/cf-page'
import { cheerio, load } from '../../shared/html/cheerio'
import {
  type HostBreaker,
  type HostTrip,
  HostUnavailableError,
  createHostBreaker,
  pathScope,
} from '../../shared/net/host-breaker'
import type { CatSpiderAction } from '../../shared/contract/online'

/** 运行时依赖（便于单测替换）。 */
export interface CatSpiderDeps {
  net: NetClient
  /** 主进程浏览器代抓；失败返回空串 */
  browserFetch: (url: string) => Promise<string>
  /** 读插件源码（带本地缓存），见 plugin-cache.ts */
  loadPlugin: (url: string) => Promise<string>
  /** 按主机 + 路径类别熔断；在线域跨请求共用一份，缺省时每次运行各建一份 */
  breaker?: HostBreaker
  /** 本次运行碰到熔断（硬封锁 / 连续失败）时回报，供上层标记站点不可用 */
  onTrip?: (trip: HostTrip) => void
  /** 调试输出 */
  log?: (line: string) => void
}

/**
 * $fetch 返回给插件的结果，形状照 XPTV：data、status、respHeaders；headers 是早期本宿主的叫法，保留。
 * respHeaders 同时给 iOS 风格的首字母大写键（Set-Cookie 多条用 ", " 连接）和小写键
 * （set-cookie 是数组），插件里两种写法都有。
 */
interface Fetched {
  data: string
  status: number
  headers: Record<string, string>
  respHeaders: Record<string, string | string[]>
}

/** content-type → Content-Type */
const canonicalHeader = (name: string): string =>
  name.replace(
    /(^|-)([a-z])/g,
    (_, dash: string, c: string) => dash + c.toUpperCase()
  )

/** 把响应头转成插件用的两种记录。 */
export function pluginHeaders(
  source: Headers
): Pick<Fetched, 'headers' | 'respHeaders'> {
  const headers: Record<string, string> = {}
  const respHeaders: Record<string, string | string[]> = {}
  source.forEach((value, key) => {
    headers[key] = value
    if (key === 'set-cookie') return
    respHeaders[key] = value
    respHeaders[canonicalHeader(key)] = value
  })
  const cookies = source.getSetCookie()
  if (cookies.length) {
    respHeaders['set-cookie'] = cookies
    respHeaders['Set-Cookie'] = cookies.join(', ')
  }
  return { headers, respHeaders }
}

/** 插件调用 $fetch 的选项。 */
interface PluginFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  timeout?: number
}

/** 插件传入的请求体：字符串原样，对象按 Content-Type 编码。 */
function encodeBody(
  body: unknown,
  headers: Record<string, string> = {}
): string | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') return body
  const type = String(headers['Content-Type'] ?? headers['content-type'] ?? '')
  return type.includes('json')
    ? JSON.stringify(body)
    : new URLSearchParams(body as Record<string, string>).toString()
}

/** 统一各版本插件的搜索词字段（keyword / text / wd）。 */
export function normalizeActionExt(ext: unknown): Record<string, unknown> {
  const value = argsify(ext)
  const query = String(value.keyword || value.text || value.wd || '')
  return {
    ...value,
    keyword: value.keyword || query,
    text: value.text || query,
    wd: value.wd || query,
  }
}

function argsify(ext: unknown): Record<string, unknown> {
  if (typeof ext === 'string') {
    try {
      return JSON.parse(ext) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return (ext as Record<string, unknown>) || {}
}

/** 插件有的直接 return JSON.stringify(...)，最多解两层。 */
export function normalizePluginResult(value: unknown): unknown {
  let result = value
  for (let i = 0; i < 2 && typeof result === 'string'; i++) {
    try {
      result = JSON.parse(result)
    } catch {
      break
    }
  }
  return result
}

/** 站点 patch：上游插件域名/路径过期时在运行时替换源码片段。 */
export function applyPatch(
  code: string,
  patch: Record<string, string> | undefined
): string {
  let out = code
  for (const [from, to] of Object.entries(patch ?? {})) {
    if (from && typeof to === 'string') out = out.split(from).join(to)
  }
  return out
}

/**
 * XPTV 插件依赖的 JSEncrypt 最小兼容：RSA PKCS#1 v1.5，密文 base64。
 * 与 JSEncrypt 一样，公钥 / 私钥都经 setKey 存一份；私钥也能加密（node 会从私钥导出公钥）。
 * 失败时 encrypt 返回 false、decrypt 返回 null，插件按假值判断。
 */
function loadJSEncrypt(): unknown {
  return class JSEncryptCompat {
    private key = ''
    setKey(key: string): void {
      this.key = key
    }
    setPublicKey(key: string): void {
      this.key = key
    }
    setPrivateKey(key: string): void {
      this.key = key
    }
    encrypt(value: string): string | false {
      if (!this.key) return false
      try {
        return publicEncrypt(
          { key: this.key, padding: constants.RSA_PKCS1_PADDING },
          Buffer.from(String(value), 'utf8')
        ).toString('base64')
      } catch {
        return false
      }
    }
    decrypt(value: string): string | null {
      if (!this.key || !value) return null
      try {
        return privateDecrypt(
          { key: this.key, padding: constants.RSA_PKCS1_PADDING },
          Buffer.from(String(value), 'base64')
        ).toString('utf8')
      } catch {
        return null
      }
    }
  }
}

function makeHtmlHelpers(): Record<string, unknown> {
  const select = (root: string, selector?: string): Cheerio<never> => {
    const $ = load(root)
    return (selector ? $(selector) : $.root()) as Cheerio<never>
  }
  return {
    elements: (html: string, selector: string) =>
      select(html, selector).toArray(),
    text(root: unknown, selector?: string): string {
      if (typeof root === 'string') return select(root, selector).text().trim()
      const $ = load(root as never)
      const node = $(root as never)
      return (selector ? node.find(selector) : node).text().trim()
    },
    attr(root: unknown, selector: string, name: string): string {
      if (typeof root === 'string')
        return select(root, selector).attr(name) || ''
      const $ = load(root as never)
      const node = $(root as never)
      return (selector ? node.find(selector).first() : node).attr(name) || ''
    },
  }
}

/**
 * 构造插件的 $fetch：
 * - 主机在熔断期：直接抛 HostUnavailableError，不发请求；
 * - 拿到硬封锁页：熔断该主机并抛错，不找浏览器（浏览器也过不去，只会弹窗打扰）；
 * - 拿到可通过的挑战页或直连出错：GET 请求改由浏览器代抓，代抓也失败记一次失败。
 */
function makeFetch(deps: CatSpiderDeps): unknown {
  const log = deps.log ?? (() => {})
  const breaker = deps.breaker ?? createHostBreaker({ scopeOf: pathScope })
  const report = (trip: HostTrip | null): void => {
    if (!trip) return
    log(`[host-breaker] ${trip.host} ${trip.reason}`)
    deps.onTrip?.(trip)
  }
  const raw = async (
    url: string,
    options: PluginFetchOptions
  ): Promise<Fetched> => {
    if (!url || typeof url !== 'string') throw new Error(`Invalid URL: ${url}`)
    const method = (options.method || 'GET').toUpperCase() as 'GET' | 'POST'
    const res = await deps.net.request(url, {
      method,
      headers: options.headers,
      body:
        method === 'POST'
          ? encodeBody(options.body, options.headers)
          : undefined,
      timeoutMs: options.timeout || 15000,
    })
    const data = new TextDecoder().decode(res.body)
    return { data, status: res.status, ...pluginHeaders(res.headers) }
  }
  const viaBrowser = async (
    url: string,
    reason: 'challenge' | 'unreachable'
  ): Promise<Fetched | null> => {
    const html = await deps.browserFetch(url).catch(() => '')
    if (html && classifyPage(html) === 'ok') {
      log(`[browser-fetch] ${url}`)
      breaker.succeed(url)
      return { data: html, status: 200, headers: {}, respHeaders: {} }
    }
    report(breaker.fail(url, reason))
    return null
  }
  const fetchWithFallback = async (
    url: string,
    options: PluginFetchOptions = {}
  ): Promise<Fetched> => {
    const open = typeof url === 'string' && url ? breaker.check(url) : null
    if (open) {
      report(open)
      throw new HostUnavailableError(open)
    }
    const canFallback =
      (options.method || 'GET').toUpperCase() === 'GET' && !options.body
    let result: Fetched
    try {
      result = await raw(url, options)
    } catch (error) {
      const fallback = canFallback ? await viaBrowser(url, 'unreachable') : null
      if (fallback) return fallback
      if (!canFallback && typeof url === 'string' && url)
        report(breaker.fail(url))
      throw error
    }
    const verdict = classifyPage(result.data)
    if (verdict === 'blocked') {
      const trip = breaker.block(url)
      report(trip)
      throw new HostUnavailableError(trip)
    }
    if (verdict === 'challenge') {
      const fallback = canFallback ? await viaBrowser(url, 'challenge') : null
      return fallback ?? result
    }
    if (result.status >= 500) report(breaker.fail(url))
    else breaker.succeed(url)
    return result
  }
  const $fetch = (
    url: string,
    options?: PluginFetchOptions
  ): Promise<Fetched> => fetchWithFallback(url, options)
  $fetch.get = (url: string, options: PluginFetchOptions = {}) =>
    fetchWithFallback(url, options)
  $fetch.post = (
    url: string,
    body: unknown,
    options: PluginFetchOptions = {}
  ) => fetchWithFallback(url, { ...options, method: 'POST', body })
  return $fetch
}

/** 插件导出的入口函数表。 */
type PluginApi = Partial<
  Record<CatSpiderAction, (ext?: string) => Promise<unknown> | unknown>
>

/**
 * 运行一次插件动作。插件异常不抛出，按原 runner 约定包进 data（success:false）。
 * 只有插件源码下载失败等宿主错误才 reject。
 */
export async function runCatSpider(
  deps: CatSpiderDeps,
  pluginUrl: string,
  action: CatSpiderAction,
  ext: Record<string, unknown>,
  patch?: Record<string, string>
): Promise<unknown> {
  const log = deps.log ?? (() => {})
  const code = applyPatch(await deps.loadPlugin(pluginUrl), patch)
  const cacheStore = new Map<string, unknown>()
  const $fetch = makeFetch(deps) as {
    get: (u: string, o?: PluginFetchOptions) => Promise<unknown>
  }
  const print = (...args: unknown[]): void =>
    log(
      args
        .map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ')
    )
  const extJson = JSON.stringify(ext)
  const sandbox: Record<string, unknown> = {
    $fetch,
    argsify,
    jsonify: (obj: unknown) => obj,
    $print: print,
    createCheerio: () => cheerio(),
    createCryptoJS: () => CryptoJS,
    $html: makeHtmlHelpers(),
    $cache: {
      get: (key: string) => cacheStore.get(key),
      set: (key: string, value: unknown) => cacheStore.set(key, value),
      remove: (key: string) => cacheStore.delete(key),
    },
    $utils: {
      toastInfo: (m: string) => print('[info]', m),
      toastError: (m: string) => print('[error]', m),
      openSafari: (url: string, userAgent?: string) =>
        $fetch.get(url, {
          headers: userAgent ? { 'User-Agent': userAgent } : {},
        }),
    },
    $config_str: extJson,
    loadJSEncrypt,
    Buffer,
    console: { log: print, error: print, warn: print },
    setTimeout,
  }
  // 插件是第三方脚本，与原 Node runner 同等信任级别：只注入上面的宿主 API。
  const factory = new Function(
    ...Object.keys(sandbox),
    `"use strict";\n${code}\n;return { getConfig: typeof getConfig === 'function' ? getConfig : undefined, getCards: typeof getCards === 'function' ? getCards : undefined, getTracks: typeof getTracks === 'function' ? getTracks : undefined, getPlayinfo: typeof getPlayinfo === 'function' ? getPlayinfo : undefined, search: typeof search === 'function' ? search : undefined };`
  ) as (...values: unknown[]) => PluginApi
  const api = factory(...Object.values(sandbox))
  const fn = api[action]
  if (typeof fn !== 'function')
    return { success: false, error: `${action} function not found in JS` }
  const normalized = normalizeActionExt(ext)
  try {
    const result =
      action === 'getConfig' ? await fn() : await fn(JSON.stringify(normalized))
    return normalizePluginResult(result)
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
