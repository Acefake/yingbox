/**
 * 豆瓣浏览（在线首页的豆瓣卡）：按条件取一页，映射成统一卡片。
 *
 * 1. 没动筛选（快捷标签）：movie.douban.com/j/search_subjects?type&tag&sort=recommend&page_limit=20&page_start；
 * 2. 动了筛选：m.douban.com/rexxar/api/v2/<movie|tv>/recommend（豆瓣「选电影 / 选剧集」页用的接口），
 *    类型 / 地区 / 年代拼进 tags（逗号分隔），类型 / 地区另写进 selected_categories，
 *    评分下限 score_range=<min>,10（本地再筛一遍），排序 sort=U|T|R|S，start / count=20。
 *
 * 条件先经 shared/douban/query.ts 白名单收过，这里只拼白名单里的值。
 * 同一页（同一地址）缓存 10 分钟、并发合并；失败不缓存。按主机熔断（连续 3 次失败，冷却 10 分钟），
 * 冷却期内直接抛 HostUnavailableError，不发请求。沙箱在海外，豆瓣会 302 到验证页，真实行为以国内实测为准。
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
import type { NetClient } from '../../shared/net/client'
import {
  type HostBreaker,
  HostUnavailableError,
  createHostBreaker,
} from '../../shared/net/host-breaker'

/** 一页结果缓存 10 分钟 */
export const BROWSE_TTL_MS = 10 * 60 * 1000
/** 内存里最多留的页数（超出丢最早的） */
const MAX_PAGES = 120

const SEARCH_SUBJECTS = 'https://movie.douban.com/j/search_subjects'
const REXXAR = 'https://m.douban.com/rexxar/api/v2'

/** 一次请求 */
export interface DoubanRequest {
  url: string
  headers: Record<string, string>
}

/** 按条件拼请求（条件须已经过 normalizeDoubanQuery） */
export function buildDoubanRequest(
  query: DoubanQuery,
  start: number
): DoubanRequest {
  if (!hasFilters(query)) {
    const params = new URLSearchParams({
      type: query.kind,
      tag: query.tag,
      sort: 'recommend',
      page_limit: String(DOUBAN_PAGE_SIZE),
      page_start: String(start),
    })
    return {
      url: `${SEARCH_SUBJECTS}?${params}`,
      headers: { Referer: 'https://movie.douban.com/' },
    }
  }
  const categories: Record<string, string> = {}
  if (query.genre) categories['类型'] = query.genre
  if (query.region) categories['地区'] = query.region
  const params = new URLSearchParams({
    refresh: '0',
    start: String(start),
    count: String(DOUBAN_PAGE_SIZE),
    selected_categories: JSON.stringify(categories),
    uncollect: 'false',
    score_range: `${query.minRating},10`,
    tags: [query.genre, query.region, query.era].filter(Boolean).join(','),
    sort: query.sort,
  })
  return {
    url: `${REXXAR}/${query.kind}/recommend?${params}`,
    headers: { Referer: 'https://movie.douban.com/explore' },
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

/** 解析快捷标签接口；不是 {subjects: []} 抛错 */
export function parseSearchSubjects(
  json: unknown,
  kind: DoubanKind,
  start: number
): DoubanPage {
  const raw = asObject(json)?.subjects
  if (!Array.isArray(raw)) throw new Error('豆瓣返回的不是条目列表')
  const items: DoubanSubject[] = []
  for (const entry of raw) {
    const s = asObject(entry)
    const id = text(s?.id)
    if (!s || !/^\d{1,12}$/.test(id)) continue
    items.push({
      id,
      title: text(s.title),
      cover: text(s.cover),
      rate: text(s.rate),
      url: subjectUrl(id),
      year: '',
      kind,
    })
  }
  return {
    items,
    next: nextStart(start, raw.length, raw.length >= DOUBAN_PAGE_SIZE),
  }
}

/** rexxar 条目的年份：year 字段，其次副标题（「2023 / 中国大陆 / 科幻」）里的四位年份 */
const yearOf = (s: Json): string =>
  /^\d{4}$/.test(text(s.year))
    ? text(s.year)
    : (/\b(?:19|20)\d{2}\b/.exec(text(s.card_subtitle))?.[0] ?? '')

/** 解析探索接口；不是 {items: []} 抛错。评分低于 minRating 的在本地丢掉 */
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
}

/** 创建豆瓣浏览服务 */
export function createDoubanBrowse(options: DoubanBrowseOptions): DoubanBrowse {
  const { net } = options
  const now = options.now ?? Date.now
  const breaker =
    options.breaker ??
    createHostBreaker({ threshold: 3, cooldownMs: 10 * 60 * 1000, now })
  const cache = new Map<string, { page: DoubanPage; at: number }>()
  const inflight = new Map<string, Promise<DoubanPage>>()

  async function fetchPage(
    query: DoubanQuery,
    start: number,
    request: DoubanRequest
  ): Promise<DoubanPage> {
    const trip = breaker.check(request.url)
    if (trip) throw new HostUnavailableError(trip)
    try {
      const json = await net.getJson(request.url, {
        headers: request.headers,
        timeoutMs: 10_000,
      })
      const page = hasFilters(query)
        ? parseRecommend(json, query.kind, start, query.minRating)
        : parseSearchSubjects(json, query.kind, start)
      breaker.succeed(request.url)
      return page
    } catch (error) {
      breaker.fail(request.url, 'unreachable')
      throw error
    }
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
