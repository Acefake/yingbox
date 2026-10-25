/**
 * 豆瓣查类型与地区：按片名 + 年份搜一次，取最像的条目，从卡片副标题里读出地区和类型。
 *
 * 走 m.douban.com/rexxar/api/v2/search/movie（移动端接口，与在线页的豆瓣请求同一套：必须带
 * Referer 与移动 UA；movie.douban.com/j/search_subjects 已一律 302 到验证页，不用）。
 * 副标题形如「中国大陆 中国香港 / 剧情 喜剧 动作 / 姜文 / 姜文 葛优」：第一段地区，第二段类型；
 * 有的卡片在前面多一段年份（「2010 / 中国大陆 / 剧情 喜剧 / …」），解析时先跳过开头的年份段。
 *
 * 只给类型补全用（genre-fill.ts）：调用方注入限速很低的 ProviderHttp（串行、2 秒一次），
 * 结果按查询词缓存 30 天（找不到也缓存），同一部片不会反复请求。
 */
import { countryCodes } from '../../../../shared/library/identify'
import { normalizeTitle } from '../../../../shared/library/scoring'
import type { ResponseCache } from '../http/provider-cache'
import type { ProviderHttp } from '../http/provider-http'

const SEARCH = 'https://m.douban.com/rexxar/api/v2/search/movie'
const HEADERS = {
  Referer: 'https://m.douban.com/movie/',
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
}
/** 查询结果缓存多久。 */
export const DOUBAN_GENRE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 要查的条目。 */
export interface DoubanGenreQuery {
  title: string
  originalTitle?: string | null
  year?: number | null
  kind: 'movie' | 'tv'
}

/** 查到的类型与地区（地区为 ISO 3166-1 代码）。 */
export interface DoubanGenres {
  genres: string[]
  countries: string[]
}

interface SearchTarget {
  title?: unknown
  year?: unknown
  card_subtitle?: unknown
}

interface SearchItem {
  target_type?: unknown
  target?: SearchTarget
}

/** 副标题里的年份段（「2010」「2010-2014」「2010(中国大陆)」）。 */
const YEAR_PART = /^\d{4}(?:\s*[-–]\s*\d{4})?(?:\s*\(.*\))?$/

/** 副标题 → 地区（换成代码）与类型；开头的年份段跳过，不像副标题返回 null。 */
export function parseCardSubtitle(subtitle: string): DoubanGenres | null {
  const parts = subtitle.trim().split(/\s+\/\s+/)
  while (parts.length && YEAR_PART.test(parts[0])) parts.shift()
  if (parts.length < 2) return null
  const regions = parts[0].split(/\s+/).filter(Boolean)
  const genres = parts[1]
    .split(/\s+/)
    .filter(g => g && /^[\p{Script=Han}]{1,6}$/u.test(g))
  return { genres, countries: countryCodes(regions) }
}

/** 片名去掉末尾季号（「绝命毒师 第一季」→「绝命毒师」）再归一化；豆瓣条目与本地片名都这样比。 */
const subjectTitle = (title: string): string =>
  normalizeTitle(title.replace(/\s*第[一二三四五六七八九十百零\d]+季\s*$/, ''))

/**
 * 从搜索结果里挑最像的条目：片名（归一化、剧集去掉季号后）等于本地片名或原名，
 * 两边都有年份时相差不超过 1 年，类型（电影 / 剧集）一致的优先；
 * 片名都对不上时（本地是外文名），只接受排第一、类型一致且年份完全相同的条目。挑不出返回 null。
 */
export function pickDoubanGenres(
  body: unknown,
  query: DoubanGenreQuery
): DoubanGenres | null {
  const items = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) return null
  const list = (items as SearchItem[]).filter(
    item => typeof item?.target?.title === 'string'
  )
  const names = new Set(
    [query.title, query.originalTitle]
      .filter((t): t is string => Boolean(t))
      .map(subjectTitle)
      .filter(Boolean)
  )
  const hits = list.filter(item => {
    const t = item.target!
    if (!names.has(subjectTitle(String(t.title)))) return false
    const year = Number(t.year)
    return !query.year || !year || Math.abs(year - query.year) <= 1
  })
  let best = hits.find(item => item.target_type === query.kind) ?? hits[0]
  if (!best && query.year) {
    const first = list[0]
    if (
      first?.target_type === query.kind &&
      Number(first.target?.year) === query.year
    )
      best = first
  }
  const subtitle = best?.target?.card_subtitle
  return typeof subtitle === 'string' ? parseCardSubtitle(subtitle) : null
}

/** 豆瓣类型查询。 */
export class DoubanGenreLookup {
  /**
   * @param http 限速很低的 HTTP 层（与它共用 cache）
   * @param cache 响应缓存，用来判断一条查询会不会发请求
   */
  constructor(
    private readonly http: ProviderHttp,
    private readonly cache?: Pick<ResponseCache, 'get'>,
    private readonly now: () => number = Date.now
  ) {}

  /** 查询词的缓存键（电影 / 剧集 + 片名 + 年份；同名同年的电影与剧集挑出的条目不同）。 */
  static cacheKey(query: DoubanGenreQuery): string {
    const title = normalizeTitle(query.title)
    return `douban:genres:${query.kind}:${title}#${query.year ?? ''}`
  }

  /** 缓存里有没有这条（有就不占请求名额）。 */
  cached(query: DoubanGenreQuery): boolean {
    const hit = this.cache?.get(DoubanGenreLookup.cacheKey(query))
    return Boolean(hit && hit.expiresAt > this.now())
  }

  /** 查一部片；豆瓣上找不到或对不上时返回 null。网络 / 拦截错误照常抛出。 */
  async lookup(
    query: DoubanGenreQuery,
    signal?: AbortSignal
  ): Promise<DoubanGenres | null> {
    const q = query.year ? `${query.title} ${query.year}` : query.title
    const body = await this.http.getJson<unknown>({
      url: `${SEARCH}?q=${encodeURIComponent(q)}&start=0&count=10`,
      headers: HEADERS,
      cacheKey: DoubanGenreLookup.cacheKey(query),
      ttl: () => DOUBAN_GENRE_TTL_MS,
      notFoundTtl: DOUBAN_GENRE_TTL_MS,
      signal,
    })
    return pickDoubanGenres(body, query)
  }
}
