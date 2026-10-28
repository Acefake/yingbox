/**
 * 豆瓣卡用 TMDB 补全：海报（w342）、年份、类型、简介、原名、搜源片名、评分。
 *
 * 每张卡依次试片名的几个写法（去空格、「第二季」→ S02、去掉季号），都没有再用 /search/multi。
 * 作品名称、已知原名、年份与类型一致才补全；出现多个匹配时保留豆瓣数据。
 * 4 路并发；直接改传入的条目（传响应式数组里的元素，改动即刷新卡片）。
 * 找不到或出错的卡退回豆瓣封面；引擎没有 TMDB 令牌时整批停下，剩下的卡也退回豆瓣封面。
 */
import { tmdb as tmdbApi } from '../api/online'
import type { DoubanItem, TmdbDetail } from '../types'
import { matchingTmdbCandidates } from './tmdb-match'

/** TMDB 搜索结果的一条（/search/multi 多一个 media_type） */
type TmdbHit = TmdbDetail & { media_type?: string }

/** 请求 TMDB 的函数（测试替换）；没有令牌返回 null */
export type TmdbSearch = (
  path: string,
  query: Record<string, string | number>
) => Promise<unknown>

const IMG_BASE = 'https://images.tmdb.org/t/p/w342'
const CONCURRENCY = 4
const ZH_NUM: Record<string, string> = {
  一: '1',
  二: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
  十: '10',
}

const stripSeason = (t: string): string =>
  t
    .replace(
      /\s*(第[一二三四五六七八九十百\d]+季|Season\s*\d+|[Ss]\d+)\s*/g,
      ''
    )
    .trim()

/** 片名里的季号（「第二季」「S2」「Season 2」） */
function seasonNumber(t: string): string | null {
  let m = t.match(/第([一二三四五六七八九十\d]+)季/)
  if (m) return ZH_NUM[m[1]] ?? m[1]
  m = t.match(/[Ss](?:eason\s*)?0*(\d+)/)
  return m ? m[1] : null
}

/** 依次尝试的搜索词 */
function titleVariants(title: string): string[] {
  const variants = [title]
  const compact = title.replace(/\s+/g, '')
  if (compact !== title) variants.push(compact)
  const num = seasonNumber(title)
  if (num) variants.push(`${stripSeason(title)}S${num.padStart(2, '0')}`)
  const stripped = stripSeason(title)
  if (stripped !== title) variants.push(stripped)
  return Array.from(new Set(variants))
}

/**
 * 给一批豆瓣卡补 TMDB 信息。
 * @param items - 要补的卡（原地修改）
 * @param kind - 这批卡来自电影还是电视剧分类
 * @param search - TMDB 请求（默认走引擎）
 */
export async function enrichFromTmdb(
  items: DoubanItem[],
  kind: 'movie' | 'tv',
  search: TmdbSearch = tmdbApi
): Promise<void> {
  const isTv = kind === 'tv'
  const NO_TOKEN = new Error('TMDB 未配置令牌')

  const find = async (
    path: string,
    q: string,
    item: DoubanItem
  ): Promise<TmdbHit[]> => {
    const res = (await search(path, {
      query: q,
      page: 1,
    })) as { results?: TmdbHit[] } | null
    if (res === null) throw NO_TOKEN
    return matchingTmdbCandidates(res?.results ?? [], {
      title: item.title,
      originalTitle: item.original_title,
      year: item.year,
      kind,
    })
  }

  const lookup = async (item: DoubanItem): Promise<TmdbHit | null> => {
    for (const v of titleVariants(item.title)) {
      const hit = await find(isTv ? '/search/tv' : '/search/movie', v, item)
      if (hit.length > 1) return null
      if (hit.length === 1) return hit[0]
    }
    const matches = await find('/search/multi', stripSeason(item.title), item)
    return matches.length === 1 ? matches[0] : null
  }

  const apply = (item: DoubanItem, hit: TmdbHit | null): void => {
    item.cover = hit?.poster_path
      ? IMG_BASE + hit.poster_path
      : item.cover || item.coverSrc
    item.backdrop = hit?.backdrop_path
      ? `https://images.tmdb.org/t/p/w1280${hit.backdrop_path}`
      : item.backdrop
    if (!hit) return
    const date = hit.release_date || hit.first_air_date || ''
    item.year = date ? date.slice(0, 4) : item.year
    const mt = hit.media_type ?? (isTv ? 'tv' : 'movie')
    item.type = mt === 'tv' ? '剧集' : '电影'
    item.overview = item.overview || hit.overview || ''
    item.original_title =
      item.original_title || hit.original_title || hit.original_name || ''
    const name = hit.name || hit.title || ''
    if (name) item.searchTitle = name
    if (typeof hit.vote_average === 'number' && hit.vote_average > 0)
      item.tmdbRate = hit.vote_average
  }

  let next = 0
  let stopped = false
  const worker = async (): Promise<void> => {
    while (!stopped && next < items.length) {
      const item = items[next++]
      try {
        apply(item, await lookup(item))
      } catch (error) {
        item.cover ||= item.coverSrc
        if (error === NO_TOKEN) stopped = true
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  // 没有令牌：没轮到的卡直接用豆瓣封面
  if (stopped) {
    for (const item of items) if (!item.cover) item.cover = item.coverSrc
  }
}
