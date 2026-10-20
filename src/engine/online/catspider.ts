/**
 * CatSpider（XPTV）插件运行时：下载插件源码，注入宿主 API（$fetch、cheerio、CryptoJS…），
 * 调用插件的 getConfig / search / getCards / getTracks / getPlayinfo。
 *
 * 取代原来 Go → Python → Node 子进程的三级调用；插件的网络请求全部经引擎 net，
 * 遇到 Cloudflare 挑战页时请主进程用浏览器代抓（替代原临时文件 + 本机端口发现）。
 */
import * as cheerio from 'cheerio'
import CryptoJS from 'crypto-js'
import { constants, privateDecrypt } from 'node:crypto'
import type { NetClient } from '../../shared/net/client'
import type { CatSpiderAction } from '../../shared/contract/online'

/** 运行时依赖（便于单测替换）。 */
export interface CatSpiderDeps {
  net: NetClient
  /** 主进程浏览器代抓；失败返回空串 */
  browserFetch: (url: string) => Promise<string>
  /** 读插件源码（带本地缓存），见 plugin-cache.ts */
  loadPlugin: (url: string) => Promise<string>
  /** 调试输出 */
  log?: (line: string) => void
}

const CHALLENGE_MARKERS = [
  'Just a moment',
  'Attention Required',
  'Enable JavaScript and cookies to continue',
  '安全验证',
  'cf-browser-verification',
  'cf_chl_opt',
]

/** 是否 Cloudflare 一类的挑战页。 */
export const isChallengePage = (data: unknown): boolean =>
  typeof data === 'string' && CHALLENGE_MARKERS.some(m => data.includes(m))

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

/** XPTV 旧插件依赖的 JSEncrypt 最小兼容（只用到私钥解密）。 */
function loadJSEncrypt(): unknown {
  return class JSEncryptCompat {
    private key = ''
    setPrivateKey(key: string): void {
      this.key = key
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
  const select = (root: string, selector?: string): cheerio.Cheerio<never> => {
    const $ = cheerio.load(root)
    return (selector ? $(selector) : $.root()) as cheerio.Cheerio<never>
  }
  return {
    elements: (html: string, selector: string) =>
      select(html, selector).toArray(),
    text(root: unknown, selector?: string): string {
      if (typeof root === 'string') return select(root, selector).text().trim()
      const $ = cheerio.load(root as never)
      const node = $(root as never)
      return (selector ? node.find(selector) : node).text().trim()
    },
    attr(root: unknown, selector: string, name: string): string {
      if (typeof root === 'string')
        return select(root, selector).attr(name) || ''
      const $ = cheerio.load(root as never)
      const node = $(root as never)
      return (selector ? node.find(selector).first() : node).attr(name) || ''
    },
  }
}

/** 构造插件的 $fetch：直连失败或拿到挑战页时，GET 请求改由浏览器代抓。 */
function makeFetch(deps: CatSpiderDeps): unknown {
  const log = deps.log ?? (() => {})
  const raw = async (
    url: string,
    options: PluginFetchOptions = {}
  ): Promise<{ data: string; headers: Record<string, string> }> => {
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
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => (headers[key] = value))
    return { data: new TextDecoder().decode(res.body), headers }
  }
  const viaBrowser = async (
    url: string
  ): Promise<{ data: string; headers: Record<string, string> } | null> => {
    const html = await deps.browserFetch(url).catch(() => '')
    if (html && !isChallengePage(html)) {
      log(`[browser-fetch] ${url}`)
      return { data: html, headers: {} }
    }
    return null
  }
  const fetchWithFallback = async (
    url: string,
    options: PluginFetchOptions = {}
  ): Promise<{ data: string; headers: Record<string, string> }> => {
    const canFallback =
      (options.method || 'GET').toUpperCase() === 'GET' && !options.body
    try {
      const result = await raw(url, options)
      if (canFallback && isChallengePage(result.data))
        return (await viaBrowser(url)) ?? result
      return result
    } catch (error) {
      if (canFallback) {
        const fallback = await viaBrowser(url)
        if (fallback) return fallback
      }
      throw error
    }
  }
  const $fetch = (url: string, options?: PluginFetchOptions) =>
    fetchWithFallback(url, options)
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
    createCheerio: () => cheerio,
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
