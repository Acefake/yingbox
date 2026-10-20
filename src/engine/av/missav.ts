/**
 * MissAV 目录与播放地址解析（由 missav_resolver.py 移植）。
 *
 * 页面请求走引擎 net（Chromium 网络栈，替代 curl_cffi 的 Chrome 指纹）；返回 403/429 或
 * Cloudflare 挑战页时，请主进程用浏览器窗口代抓。视频流与封面不再经本地代理：渲染层直连
 * surrit.com / fourhoi.com，Referer 由主进程 media-headers 注入。
 */
import type { NetClient } from '../../shared/net/client'
import type {
  AvCatalogPage,
  AvCategory,
  AvSort,
  AvStream,
} from '../../shared/contract/av'

/** 解析失败，code 供渲染层区分提示。 */
export class ResolveError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ResolveError'
  }
}

const PAGE_HOSTS = new Set(['missav.ai', 'missav.ws', 'missav.com'])

/** 目录分类（顺序即界面顺序）。 */
export const CATEGORIES: ReadonlyArray<{ id: AvCategory; name: string }> = [
  { id: 'new', name: '最新更新' },
  { id: 'release', name: '新作发布' },
  { id: 'chinese-subtitle', name: '中文字幕' },
  { id: 'uncensored-leak', name: '无码流出' },
  { id: 'english-subtitle', name: '英语字幕' },
  { id: 'fc2', name: 'FC2' },
  { id: 'madou', name: '麻豆传媒' },
  { id: 'heyzo', name: 'HEYZO' },
]
const CATEGORY_IDS = new Set<string>(CATEGORIES.map(c => c.id))
const SORTS: Record<AvSort, string> = {
  latest: '',
  hot: 'monthly_views',
  rating: 'views',
}
const CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 番号或 MissAV 链接 → 规范的 HTTPS 页面地址。 */
export function pageUrl(value: string): string {
  const input = value.trim()
  if (/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(input) && input.length <= 120)
    return `https://missav.ai/cn/${input.toLowerCase()}`
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new ResolveError(
      'INVALID_INPUT',
      '请输入 MissAV 的 HTTPS 视频链接或番号'
    )
  }
  if (
    url.protocol !== 'https:' ||
    !PAGE_HOSTS.has(url.hostname) ||
    (url.port !== '' && url.port !== '443') ||
    url.username ||
    url.password ||
    !url.pathname.replace(/\//g, '') ||
    input.length > 2048
  )
    throw new ResolveError(
      'INVALID_INPUT',
      '请输入 MissAV 的 HTTPS 视频链接或番号'
    )
  url.hash = ''
  return url.toString()
}

/** 是否 MissAV 的媒体 CDN 地址（只认 https://surrit.com）。 */
export function isMediaUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'surrit.com' &&
      (url.port === '' || url.port === '443') &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

const unescapeHtml = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

/** 从页面里找 HLS 地址：直链，或打包脚本里的 UUID。 */
export function extractStream(page: string): string {
  const decoded = unescapeHtml(page).replace(/\\\//g, '/')
  const direct = decoded.match(
    /https:\/\/surrit\.com\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/
  )
  if (direct) return direct[0]
  const packed = decoded.match(/m3u8\|([a-f0-9|]+)\|com\|surrit\|https\|video/)
  if (packed) {
    const uuid = packed[1].split('|').reverse().join('-')
    if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(uuid))
      return `https://surrit.com/${uuid}/playlist.m3u8`
  }
  throw new ResolveError(
    'STREAM_NOT_FOUND',
    '页面未返回可识别的视频流，站点解析规则可能已变化'
  )
}

/** 目录页地址。 */
export function listingUrl(
  category: string,
  page: number,
  sort: string
): string {
  if (!CATEGORY_IDS.has(category))
    throw new ResolveError('INVALID_INPUT', '不支持的 MissAV 分类')
  if (!(sort in SORTS))
    throw new ResolveError('INVALID_INPUT', '不支持的 MissAV 排序')
  if (!Number.isInteger(page) || page < 1 || page > 2000)
    throw new ResolveError('INVALID_INPUT', '页码超出范围')
  const query = new URLSearchParams()
  if (page > 1) query.set('page', String(page))
  const sortKey = SORTS[sort as AvSort]
  if (sortKey) query.set('sort', sortKey)
  const qs = query.toString()
  return `https://missav.ai/cn/${category}${qs ? `?${qs}` : ''}`
}

/** 目录条目链接 → 番号；不是视频页返回空串。 */
function catalogCode(href: string): string {
  try {
    const url = new URL(unescapeHtml(href))
    if (url.protocol !== 'https:' || !PAGE_HOSTS.has(url.hostname)) return ''
    const code = url.pathname
      .replace(/\/+$/, '')
      .split('/')
      .pop()!
      .toLowerCase()
    return CATEGORY_IDS.has(code) || !CODE.test(code) || code.length > 80
      ? ''
      : code
  } catch {
    return ''
  }
}

/** 解析目录页 HTML：最多 48 条，附带是否有下一页。 */
export function parseCatalog(page: string): {
  items: AvCatalogPage['items']
  hasNext: boolean
} {
  const items: AvCatalogPage['items'] = []
  const seen = new Set<string>()
  for (const chunk of page.split('class="thumbnail group"').slice(1)) {
    const link = chunk.match(
      /href="(https:\/\/missav\.(?:ai|ws|com)\/[^"#]+)"/i
    )
    const code = link ? catalogCode(link[1]) : ''
    if (!code || seen.has(code)) continue
    seen.add(code)
    const titleMatch = chunk.match(
      /class="text-secondary[^"]*"[^>]*>\s*([^<]+)/
    )
    const title = titleMatch
      ? unescapeHtml(titleMatch[1]).replace(/\s+/g, ' ').trim()
      : ''
    const poster = chunk.match(
      /https:\/\/fourhoi\.com\/[a-z0-9-]+\/cover-t\.jpg/i
    )
    const duration = chunk.match(/>\s*(\d{1,3}:\d{2}:\d{2})\s*</)
    items.push({
      code,
      title: (title || code.toUpperCase()).slice(0, 180),
      poster: poster ? poster[0] : '',
      duration: duration ? duration[1] : '',
    })
    if (items.length >= 48) break
  }
  return { items, hasNext: page.includes('rel="next"') }
}

/** 封面地址（fourhoi.com，Referer 由主进程注入）。 */
export function coverUrl(code: string): string {
  return `https://fourhoi.com/${code.toLowerCase()}/cover-t.jpg`
}

/** 解析器依赖。 */
export interface MissavDeps {
  net: NetClient
  browserFetch: (url: string, waitMs?: number) => Promise<string>
}

const isChallenge = (text: string): boolean =>
  text.includes('Just a moment') || text.includes('cf-chl-')

/** 取一个 MissAV 页面；被挑战时改用浏览器代抓。重定向只允许留在 MissAV 域内。 */
async function fetchDocument(
  deps: MissavDeps,
  url: string
): Promise<{ text: string; status: number; url: string }> {
  const res = await deps.net.request(url, {
    timeoutMs: 15000,
    maxBytes: 8 * 1024 * 1024,
    allow: target => PAGE_HOSTS.has(target.hostname),
    headers: { Referer: 'https://missav.ai/' },
  })
  const text = new TextDecoder().decode(res.body)
  if (res.status === 403 || res.status === 429 || isChallenge(text)) {
    const rendered = await deps.browserFetch(res.url, 20000)
    if (!rendered)
      throw new ResolveError(
        'SITE_VERIFICATION_REQUIRED',
        'MissAV 的站点验证尚未通过；如果影盒右下角出现验证窗口，请在窗口中完成验证后重试'
      )
    return { text: rendered, status: 200, url: res.url }
  }
  return { text, status: res.status, url: res.url }
}

/** 拉一页目录。 */
export async function listCatalog(
  deps: MissavDeps,
  category: AvCategory,
  page: number,
  sort: AvSort
): Promise<AvCatalogPage> {
  const target = listingUrl(category, page, sort)
  const { text, status } = await fetchDocument(deps, target)
  if (status !== 200)
    throw new ResolveError(
      'UPSTREAM_ERROR',
      `MissAV 列表请求失败（HTTP ${status}）`
    )
  const { items, hasNext } = parseCatalog(text)
  if (page === 1 && !items.length)
    throw new ResolveError(
      'STREAM_NOT_FOUND',
      'MissAV 列表没有解析到视频，站点页面结构可能已变化'
    )
  return {
    category,
    page,
    pageCount: hasNext && items.length ? page + 1 : page,
    categories: [...CATEGORIES],
    items,
  }
}

/** 番号 / 链接 → HLS 地址。番号会依次尝试中文字幕、无码流出版本。 */
export async function resolveStream(
  deps: MissavDeps,
  input: string
): Promise<AvStream> {
  const initial = pageUrl(input)
  const candidates = [initial]
  if (!input.includes('://'))
    candidates.push(`${initial}-chinese-subtitle`, `${initial}-uncensored-leak`)
  for (const candidate of candidates) {
    const { text, status, url } = await fetchDocument(deps, candidate)
    if (status === 404) continue
    if (status !== 200)
      throw new ResolveError(
        'UPSTREAM_ERROR',
        `MissAV 页面请求失败（HTTP ${status}）`
      )
    const stream = extractStream(text)
    if (!isMediaUrl(stream))
      throw new ResolveError('STREAM_NOT_FOUND', '视频流地址不受支持')
    const code = new URL(url).pathname.replace(/\/+$/, '').split('/').pop()
    return { url: stream, title: `MissAV · ${code}`, input }
  }
  throw new ResolveError(
    'NOT_FOUND',
    '没有找到对应的 MissAV 视频，请尝试粘贴完整视频链接'
  )
}
