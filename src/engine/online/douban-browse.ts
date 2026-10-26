/**
 * 豆瓣浏览（在线首页的豆瓣卡）：按条件取一页，映射成统一卡片。
 *
 * 全部走 m.douban.com/rexxar/api/v2（只要 Referer；旧 movie.douban.com/j/search_subjects 已一律 302 到验证页）：
 * 1. 没动筛选（快捷标签）：按 douban-quick.ts 的映射走 /subject/recent_hot 热门榜或 /recommend；
 * 2. 动了筛选：/<movie|tv>/recommend（豆瓣「选电影 / 选剧集」页用的接口），
 *    类型 / 地区 / 年代拼进 tags（逗号分隔），类型 / 地区另写进 selected_categories，
 *    评分下限 score_range=<min>,10（本地再筛一遍），排序 sort=U|T|R|S，start / count=20。
 *
 * 条件先经 shared/douban/query.ts 白名单收过，这里只拼白名单里的值。
 * 同一页（同一地址）缓存 10 分钟、并发合并；失败不缓存。按主机熔断（连续 3 次失败，冷却 10 分钟），
 * 冷却期内直接抛 HostUnavailableError，不发请求。
 *
 * rexxar 失败（403 / 418 / 验证页 / 超时 / 熔断中）或整页为空时，把同一个地址换成 frodo.douban.com
 * 签名后再取一次（shared/douban/frodo，开关 YINGBOX_DOUBAN_FRODO，默认开）：frodo 结果映射成 rexxar 结构，
 * 走同一个 parseRecommend、同一份页缓存（键仍是 rexxar 地址，即「同一个查询」）、同一个熔断器（按主机各记各的）。
 */
import {
  DOUBAN_MAX_START,
  DOUBAN_PAGE_SIZE,
  type DoubanKind,
  type DoubanPage,
  type DoubanQuery,
  type DoubanSubject,
  hasFilters,
} from '../../shared/douban/query'
import {
  frodoEnabled,
  mapList,
  rexxarToFrodo,
  withFrodoFallback,
} from '../../shared/douban/frodo'
import type { NetClient } from '../../shared/net/client'
import {
  type HostBreaker,
  HostUnavailableError,
  createHostBreaker,
} from '../../shared/net/host-breaker'
import { quickSource } from './douban-quick'

/** 一页结果缓存 10 分钟 */
export const BROWSE_TTL_MS = 10 * 60 * 1000
/** 内存里最多留的页数（超出丢最早的） */
const MAX_PAGES = 120

const REXXAR = 'https://m.douban.com/rexxar/api/v2'

/** 一次请求 */
export interface DoubanRequest {
  url: string
  headers: Record<string, string>
}

const REFERER = { Referer: 'https://movie.douban.com/explore' }

/** /recommend 的地址 */
function recommendUrl(
  kind: DoubanKind,
  start: number,
  params: {
    tags: string
    categories: Record<string, string>
    sort: string
    minRating: number
  }
): string {
  const search = new URLSearchParams({
    refresh: '0',
    start: String(start),
    count: String(DOUBAN_PAGE_SIZE),
    selected_categories: JSON.stringify(params.categories),
    uncollect: 'false',
    score_range: `${params.minRating},10`,
    tags: params.tags,
    sort: params.sort,
  })
  return `${REXXAR}/${kind}/recommend?${search}`
}

/** 按条件拼请求（条件须已经过 normalizeDoubanQuery） */
export function buildDoubanRequest(
  query: DoubanQuery,
  start: number
): DoubanRequest {
  if (!hasFilters(query)) {
    const source = quickSource(query.kind, query.tag)
    if (source.api === 'recent_hot') {
      const params = new URLSearchParams({
        start: String(start),
        limit: String(DOUBAN_PAGE_SIZE),
        category: source.category,
        type: source.type,
      })
      return {
        url: `${REXXAR}/subject/recent_hot/${query.kind}?${params}`,
        headers: REFERER,
      }
    }
    return {
      url: recommendUrl(query.kind, start, { ...source, minRating: 0 }),
      headers: REFERER,
    }
  }
  const categories: Record<string, string> = {}
  if (query.genre) categories['类型'] = query.genre
  if (query.region) categories['地区'] = query.region
  return {
    url: recommendUrl(query.kind, start, {
      tags: [query.genre, query.region, query.era].filter(Boolean).join(','),
      categories,
      sort: query.sort,
      minRating: query.minRating,
    }),
    headers: REFERER,
  }
}

type Json = Record<string, unknown>

const asObject = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const subjectUrl = (id: string): string =>
  `https://movie.douban.com/subject/${id}/`

/** 下一页的 start：本页有数据且没到上限才有 */
function nextStart(start: number, got: number, more: boolean): number | null {
  const next = start + DOUBAN_PAGE_SIZE
  return got > 0 && more && next <= DOUBAN_MAX_START ? next : null
}

/** rexxar 条目的年份：year 字段，其次副标题（「2023 / 中国大陆 / 科幻」）里的四位年份 */
const yearOf = (s: Json): string =>
  /^\d{4}$/.test(text(s.year))
    ? text(s.year)
    : (/\b(?:19|20)\d{2}\b/.exec(text(s.card_subtitle))?.[0] ?? '')

/** 解析 rexxar 列表（recent_hot 与 recommend 同一形状）；不是 {items: []} 抛错。评分低于 minRating 的在本地丢掉 */
export function parseRecommend(
  json: unknown,
  kind: DoubanKind,
  start: number,
  minRating: number
): DoubanPage {
  const body = asObject(json)
  const raw = body?.items
  if (!Array.isArray(raw)) throw new Error('豆瓣返回的不是条目列表')
  const items: DoubanSubject[] = []
  for (const entry of raw) {
    const s = asObject(entry)
    const id = text(s?.id)
    if (!s || !/^\d{1,12}$/.test(id)) continue
    // 列表里夹着广告 / 片单等其他卡片：只要影视条目
    if (s.type !== undefined && s.type !== 'movie' && s.type !== 'tv') continue
    const score = Number(asObject(s.rating)?.value)
    const rated = Number.isFinite(score) && score > 0
    if (minRating > 0 && (!rated || score < minRating)) continue
    const pic = asObject(s.pic)
    items.push({
      id,
      title: text(s.title),
      cover: text(pic?.normal) || text(pic?.large) || text(s.cover_url),
      rate: rated ? score.toFixed(1) : '',
      url: subjectUrl(id),
      year: yearOf(s),
      kind,
    })
  }
  const total = Number(body?.total)
  const more = !Number.isFinite(total) || start + DOUBAN_PAGE_SIZE < total
  return { items, next: nextStart(start, raw.length, more) }
}

/** 豆瓣浏览服务 */
export interface DoubanBrowse {
  /** 按条件取 start 起的一页；失败 / 熔断中抛错 */
  page(query: DoubanQuery, start: number): Promise<DoubanPage>
}

/** 依赖 */
export interface DoubanBrowseOptions {
  net: NetClient
  now?: () => number
  breaker?: HostBreaker
  /** rexxar 失败时回退到 frodo；缺省读环境变量 YINGBOX_DOUBAN_FRODO（默认开） */
  frodo?: boolean
  /** 走了 frodo 时的日志 */
  log?: (line: string) => void
}

/** 整页为空且没有下一页：风控时常见的「200 + 空列表」 */
const isEmptyPage = (page: DoubanPage): boolean =>
  page.items.length === 0 && page.next === null

/** 创建豆瓣浏览服务 */
export function createDoubanBrowse(options: DoubanBrowseOptions): DoubanBrowse {
  const { net } = options
  const now = options.now ?? Date.now
  const breaker =
    options.breaker ??
    createHostBreaker({ threshold: 3, cooldownMs: 10 * 60 * 1000, now })
  const frodo = options.frodo ?? frodoEnabled()
  const cache = new Map<string, { page: DoubanPage; at: number }>()
  const inflight = new Map<string, Promise<DoubanPage>>()

  /** 取一页（rexxar 或 frodo 地址都走这里：同一个熔断器，frodo 的响应先映射成 rexxar 结构） */
  async function fetchFrom(
    query: DoubanQuery,
    start: number,
    request: DoubanRequest,
    map: (json: unknown) => unknown = json => json
  ): Promise<DoubanPage> {
    const trip = breaker.check(request.url)
    if (trip) throw new HostUnavailableError(trip)
    try {
      const json = await net.getJson(request.url, {
        headers: request.headers,
        timeoutMs: 10_000,
      })
      const page = parseRecommend(map(json), query.kind, start, query.minRating)
      breaker.succeed(request.url)
      return page
    } catch (error) {
      breaker.fail(request.url, 'unreachable')
      throw error
    }
  }

  function fetchPage(
    query: DoubanQuery,
    start: number,
    request: DoubanRequest
  ): Promise<DoubanPage> {
    return withFrodoFallback({
      enabled: frodo,
      label: '豆瓣浏览',
      rexxar: () => fetchFrom(query, start, request),
      frodo: () => {
        const signed = rexxarToFrodo(request.url, now())
        if (!signed) throw new Error('不是 rexxar 地址')
        return fetchFrom(query, start, signed, mapList)
      },
      isEmpty: isEmptyPage,
      log: options.log,
    })
  }

  return {
    page(query, start) {
      const request = buildDoubanRequest(query, start)
      const key = request.url
      const hit = cache.get(key)
      if (hit && now() - hit.at < BROWSE_TTL_MS)
        return Promise.resolve(hit.page)
      const pending = inflight.get(key)
      if (pending) return pending
      const task = fetchPage(query, start, request)
        .then(page => {
          cache.delete(key)
          cache.set(key, { page, at: now() })
          while (cache.size > MAX_PAGES)
            cache.delete(cache.keys().next().value as string)
          return page
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, task)
      return task
    },
  }
}
