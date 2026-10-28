/**
 * 番号 → m3u8 的站点解析器，按站点权重排序。
 *
 * 每个站点拆成「取页面」与「从页面解析 m3u8」两步；解析是纯函数，单测直接覆盖。
 * 页面请求走引擎 net，被 Cloudflare 拦下时请主进程浏览器代抓。
 */
import type { NetClient } from '../../shared/net/client'
import { classifyPage } from '../../shared/net/cf-page'

/** 解析出的下载源。 */
export interface ResolvedSource {
  site: string
  m3u8: string
  /** 分片请求要带的 Referer */
  referer: string
}

/** 站点解析器。 */
export interface SourceSite {
  name: string
  /** 站点权重：越大越先尝试 */
  weight: number
  referer: string
  /** 给番号取一份可解析的页面文本；取不到返回 undefined */
  fetchPage(code: string, get: PageGetter): Promise<string | undefined>
  /** 从页面文本解析 m3u8；解析不到返回 undefined */
  parse(page: string): string | undefined
}

/** 取页面：失败返回 undefined（不抛错，好让调用方换下一个站点）。 */
export type PageGetter = (
  url: string,
  referer?: string
) => Promise<string | undefined>

const first = (text: string, re: RegExp): string | undefined =>
  text.match(re)?.[1]

/** Jable：页面里的 `var hlsUrl = '...'`。 */
export const jable: SourceSite = {
  name: 'Jable',
  weight: 1500,
  referer: 'https://jable.tv/',
  fetchPage: (code, get) =>
    get(`https://jable.tv/videos/${code.toLowerCase()}/`),
  parse: page => first(page, /var hlsUrl = '(https?:\/\/[^']+)'/),
}

/** Memo：接口返回 URL 编码的地址。 */
export const memo: SourceSite = {
  name: 'Memo',
  weight: 600,
  referer: 'https://memojav.com/',
  fetchPage: (code, get) =>
    get(
      `https://memojav.com/hls/get_video_info.php?id=${code}&sig=NTg1NTczNg&sts=7264825`,
      'https://memojav.com'
    ),
  parse(page) {
    const encoded = first(page, /"url":"(https?%3A%2F%2F[^"]+)"/)
    if (!encoded) return undefined
    try {
      return decodeURIComponent(encoded)
    } catch {
      return undefined
    }
  },
}

/** KanAV：先搜索拿播放页，播放页里是 base64 + URL 编码的地址。 */
export const kanav: SourceSite = {
  name: 'KanAV',
  weight: 490,
  referer: 'https://kanav.info/',
  async fetchPage(code, get) {
    const search = await get(
      `https://kanav.info/index.php/vod/search.html?wd=${encodeURIComponent(code)}&by=time_add`
    )
    const path =
      search && first(search, /href="(\/index\.php\/vod\/play[^"]*\.html)"/)
    return path ? get(`https://kanav.info${path}`) : undefined
  },
  parse(page) {
    const encoded = first(page, /"url":"([A-Za-z0-9+/=]+)"/)
    if (!encoded) return undefined
    try {
      return decodeURIComponent(
        Buffer.from(encoded, 'base64').toString('utf-8')
      )
    } catch {
      return undefined
    }
  },
}

/** HohoJ：先搜索拿 id，再取嵌入页里的 `var videoSrc = "..."`。 */
export const hohoj: SourceSite = {
  name: 'HohoJ',
  weight: 400,
  referer: 'https://hohoj.tv/',
  async fetchPage(code, get) {
    const search = await get(
      `https://hohoj.tv/search?text=${encodeURIComponent(code)}`
    )
    const id = search && first(search, /[?&]id=(\d+)/)
    return id
      ? get(
          `https://hohoj.tv/embed?id=${id}`,
          `https://hohoj.tv/video?id=${id}`
        )
      : undefined
  },
  parse: page => first(page, /var videoSrc\s*=\s*"([^"]+)"/),
}

/** 全部站点，按权重从高到低。 */
export const SITES: readonly SourceSite[] = [jable, memo, kanav, hohoj].sort(
  (a, b) => b.weight - a.weight
)

/** 页面获取所需依赖。 */
export interface SourceDeps {
  net: NetClient
  browserFetch: (url: string) => Promise<string>
}

/**
 * 构造页面获取函数：直连 → 被挑战时浏览器代抓 → 仍失败返回 undefined。
 * 硬封锁页直接返回 undefined，换下一个站点，不开浏览器窗口。
 */
export function pageGetter(deps: SourceDeps): PageGetter {
  return async (url, referer) => {
    try {
      const res = await deps.net.request(url, {
        headers: referer ? { Referer: referer } : {},
        timeoutMs: 15000,
        maxBytes: 8 * 1024 * 1024,
      })
      const text = new TextDecoder().decode(res.body)
      const verdict = classifyPage(text)
      if (verdict === 'blocked') return undefined
      if (res.status === 403 || res.status === 429 || verdict === 'challenge') {
        const html = await deps.browserFetch(url)
        return html || undefined
      }
      return res.status >= 200 && res.status < 300 ? text : undefined
    } catch {
      return undefined
    }
  }
}

/** 按权重依次尝试各站点，返回第一个解析出的下载源。 */
export async function resolveSource(
  code: string,
  get: PageGetter,
  sites: readonly SourceSite[] = SITES
): Promise<ResolvedSource> {
  for (const site of sites) {
    const page = await site.fetchPage(code, get)
    const m3u8 = page ? site.parse(page) : undefined
    if (m3u8) return { site: site.name, m3u8, referer: site.referer }
  }
  throw new Error(`所有站点都没有找到 ${code} 的视频流`)
}
