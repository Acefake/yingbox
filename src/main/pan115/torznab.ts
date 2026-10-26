/**
 * Torznab 搜索（Prowlarr / Jackett）：GET {接口}?t=search|movie|tvsearch&apikey=…&q=…，读 RSS XML。
 *
 * - 地址：Prowlarr 每个索引器一个（http://NAS:9696/1/api），Jackett 有聚合接口
 *   （http://NAS:9117/api/v2.0/indexers/all/results/torznab/api）；只填主机时补 /api。可以填多个，并发搜，
 *   一个失败只记一条说明，不拖垮别的；
 * - 有 imdbid / tmdbid 时用 movie / tvsearch 并带上，索引器不支持（错误码 201–203）时退回 t=search；
 * - 每条结果优先取 magneturl / magnet: 链接 / infohash；只有 .torrent 下载地址的，按做种数取前
 *   {@link RESOLVE_MAX} 条解析：同主机 302 到 magnet: 就用它，返回种子文件就算 infohash（torrent.ts）；
 *   下载地址不在 Torznab 接口那台主机上的不碰；
 * - 出网范围与 PanSou 相同：用户填的局域网地址，不做私网拦截，重定向只跟同一主机（sameHostFetch）。
 * XML 解析在 torznab-xml.ts。
 */
import type { MagnetItem } from '../../shared/contract/pan115'
import { Pan115Error } from './errors'
import {
  type FetchLike,
  fetchResponse,
  isOfflineScheme,
  sameHostFetch,
} from './http'
import {
  MAX_MAGNETS,
  magnetOf,
  mergeMagnets,
  parseOfflineLink,
} from './magnet-link'
import {
  type TorznabEntry,
  attrOf,
  parseTorznab,
  torznabError,
} from './torznab-xml'
import { parseTorrent } from './torrent'

/** 只有种子下载地址的结果，最多解析几条 */
export const RESOLVE_MAX = 10
/** 解析种子的并发数 */
const RESOLVE_CONCURRENCY = 4
/** 种子文件大小上限（字节） */
const MAX_TORRENT_BYTES = 4 * 1024 * 1024
/** 搜索与解析的超时（毫秒）；Jackett 聚合全部索引器时较慢 */
const SEARCH_TIMEOUT_MS = 45_000
const RESOLVE_TIMEOUT_MS = 15_000
const LABEL = 'Torznab'

/** 搜索条件 */
export interface TorznabQuery {
  q: string
  kind?: 'movie' | 'tv'
  /** tt1234567 或 1234567 */
  imdbId?: string
  tmdbId?: number
  season?: number
  episode?: number
}

/** 设置里的一行地址 → 接口地址；只填主机（或以 / 结尾）时补 /api；不是 http(s) 时抛错 */
export function torznabEndpoint(raw: string): string {
  const trimmed = raw.trim()
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed))
    throw new Pan115Error('Torznab 地址应以 http:// 或 https:// 开头')
  const url = new URL(trimmed)
  url.searchParams.delete('apikey')
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/api'
  return url.toString()
}

/** 一次请求的地址（API Key 只在主进程拼进去） */
export function torznabSearchUrl(
  endpoint: string,
  apiKey: string,
  query: TorznabQuery,
  plain = false
): string {
  const url = new URL(endpoint)
  const imdb = query.imdbId?.replace(/^tt/i, '')
  const typed = !plain && query.kind && (imdb || query.tmdbId)
  url.searchParams.set(
    't',
    typed ? (query.kind === 'tv' ? 'tvsearch' : 'movie') : 'search'
  )
  if (apiKey) url.searchParams.set('apikey', apiKey)
  url.searchParams.set('q', query.q.trim())
  if (typed) {
    if (imdb && /^\d+$/.test(imdb)) url.searchParams.set('imdbid', imdb)
    if (query.tmdbId) url.searchParams.set('tmdbid', String(query.tmdbId))
    if (query.kind === 'tv' && query.season)
      url.searchParams.set('season', String(query.season))
    if (query.kind === 'tv' && query.episode)
      url.searchParams.set('ep', String(query.episode))
  }
  url.searchParams.set('extended', '1')
  url.searchParams.set('limit', '100')
  return url.toString()
}

/** 读响应体为文本；HTTP 失败时若是 Torznab 错误 XML 抛它的说明 */
async function readXml(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  if (response.ok) return body
  throw (
    torznabError(body) ??
    new Pan115Error(`${LABEL} 返回 HTTP ${response.status}`)
  )
}

/**
 * 解析一条只有种子下载地址的结果：同主机 302 到磁力就用它，返回种子文件就算 infohash。
 * 下载地址不在接口主机上、或解析不出时返回 null。
 */
export async function resolveDownload(
  fetch: FetchLike,
  endpoint: string,
  entry: TorznabEntry
): Promise<string | null> {
  if (!entry.download) return null
  if (new URL(entry.download).hostname !== new URL(endpoint).hostname)
    return null
  try {
    const response = await fetchResponse(
      sameHostFetch(fetch, LABEL),
      LABEL,
      entry.download,
      {},
      RESOLVE_TIMEOUT_MS
    )
    const location = response.headers.get('location')
    if (location && isOfflineScheme(location))
      return parseOfflineLink(location) ? location.trim() : null
    if (!response.ok) return null
    const length = Number(response.headers.get('content-length'))
    if (length > MAX_TORRENT_BYTES) return null
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.length > MAX_TORRENT_BYTES) return null
    const head = Buffer.from(data.subarray(0, 8)).toString()
    if (isOfflineScheme(head)) {
      const text = Buffer.from(data).toString().trim()
      return parseOfflineLink(text) ? text : null
    }
    const torrent = parseTorrent(data)
    return torrent
      ? magnetOf(torrent.hash, torrent.name || entry.title, torrent.trackers)
      : null
  } catch {
    return null
  }
}

/** 并发跑一组任务，最多 limit 个同时进行 */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  )
  return results
}

/** 一条结果 + 链接 → 磁力条目；链接解析不出时 null */
function toMagnet(entry: TorznabEntry, link: string): MagnetItem | null {
  const parsed = parseOfflineLink(link)
  if (!parsed) return null
  return {
    title: entry.title,
    origin: 'torznab',
    source: entry.indexer.slice(0, 80),
    kind: parsed.kind,
    link,
    hash: parsed.hash,
    datetime: entry.datetime,
    size: entry.size ?? parsed.size,
    seeders: entry.seeders,
    peers: entry.peers,
  }
}

/** 搜一个接口：取 XML、解析、补种子地址 */
async function searchOne(
  fetch: FetchLike,
  endpoint: string,
  apiKey: string,
  query: TorznabQuery
): Promise<MagnetItem[]> {
  const send = sameHostFetch(fetch, LABEL)
  const host = new URL(endpoint).host
  const get = async (plain: boolean): Promise<TorznabEntry[]> => {
    const response = await fetchResponse(
      send,
      LABEL,
      torznabSearchUrl(endpoint, apiKey, query, plain),
      {},
      SEARCH_TIMEOUT_MS
    )
    return parseTorznab(await readXml(response), host)
  }
  let entries: TorznabEntry[]
  try {
    entries = await get(false)
  } catch (error) {
    const code = error instanceof Pan115Error ? error.code : undefined
    if (!query.kind || !code || code < 201 || code > 203) throw error
    entries = await get(true)
  }
  const pending = entries
    .filter(entry => !entry.link && entry.download)
    .sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1))
    .slice(0, RESOLVE_MAX)
  const resolved = await pool(pending, RESOLVE_CONCURRENCY, entry =>
    resolveDownload(fetch, endpoint, entry)
  )
  const links = new Map(pending.map((entry, i) => [entry, resolved[i]]))
  const items: MagnetItem[] = []
  for (const entry of entries) {
    const link = entry.link ?? links.get(entry)
    const item = link ? toMagnet(entry, link) : null
    if (item) items.push(item)
  }
  return items
}

/** 一个接口的报错前缀：主机名 */
const hostOf = (endpoint: string): string => new URL(endpoint).host

/**
 * 并发搜全部接口。每个接口失败只记一条说明；全部失败时抛第一个错误。
 * @returns 合并去重、按做种数排序后的磁力，和失败说明
 */
export async function searchTorznab(
  fetch: FetchLike,
  urls: readonly string[],
  apiKey: string,
  query: TorznabQuery
): Promise<{ magnets: MagnetItem[]; notes: string[] }> {
  const endpoints = urls.map(torznabEndpoint)
  const settled = await Promise.allSettled(
    endpoints.map(endpoint => searchOne(fetch, endpoint, apiKey, query))
  )
  const notes: string[] = []
  const lists: MagnetItem[][] = []
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') lists.push(result.value)
    else
      notes.push(
        `${LABEL}（${hostOf(endpoints[i])}）：${(result.reason as Error).message.replace(/^Torznab[：\s]*/, '')}`
      )
  })
  if (!lists.length) throw new Pan115Error(notes.join('；'))
  return { magnets: mergeMagnets(lists, MAX_MAGNETS), notes }
}

/** 测试一个接口：t=caps 看能不能连上、Key 对不对；返回一句说明 */
async function testOne(
  fetch: FetchLike,
  endpoint: string,
  apiKey: string
): Promise<string> {
  const url = new URL(endpoint)
  url.searchParams.set('t', 'caps')
  if (apiKey) url.searchParams.set('apikey', apiKey)
  const response = await fetchResponse(
    sameHostFetch(fetch, LABEL),
    LABEL,
    url.toString(),
    {},
    RESOLVE_TIMEOUT_MS
  )
  const xml = await readXml(response)
  const failure = torznabError(xml)
  if (failure) throw failure
  if (!/<caps[\s>]/i.test(xml))
    throw new Pan115Error('返回的不是 Torznab 能力说明')
  const title = attrOf(xml, 'server', 'title')
  const modes = ['movie-search', 'tv-search'].filter(mode =>
    new RegExp(`<${mode}\\s[^>]*available\\s*=\\s*["']yes["']`, 'i').test(xml)
  )
  const support = modes.length
    ? `支持${modes.map(m => (m === 'movie-search' ? '电影' : '剧集')).join(' / ')}搜索`
    : '只支持关键词搜索'
  return `${title || '可用'} · ${support}`
}

/** 测试全部接口：每个地址一行结果（失败也是一行，不抛） */
export async function testTorznab(
  fetch: FetchLike,
  urls: readonly string[],
  apiKey: string
): Promise<{ ok: boolean; lines: string[] }> {
  let ok = true
  const lines = await Promise.all(
    urls.map(async raw => {
      try {
        const endpoint = torznabEndpoint(raw)
        return `${hostOf(endpoint)}：${await testOne(fetch, endpoint, apiKey)}`
      } catch (error) {
        ok = false
        const message = (error as Error).message.replace(/^Torznab[：\s]*/, '')
        return `${raw.trim() || '（空）'}：${message}`
      }
    })
  )
  return { ok, lines }
}
