/**
 * 网盘页 Hero 的影片匹配规则（纯函数）：搜索词 → TMDB 搜索结果里挑一部片 → Hero 要显示的剧照、标志、
 * 年份 · 类型 · 时长与评分。请求在 composables/use-hero-match.ts，这里只做挑选与整理。
 */

const TMDB_IMAGE = 'https://image.tmdb.org/t/p'
const MAX_QUERY = 60

/** TMDB /search/multi 的一条 */
export interface TmdbSearchHit {
  id: number
  media_type?: string
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  backdrop_path?: string | null
}

/** TMDB /movie/{id} 或 /tv/{id}（带 images）里用到的字段 */
export interface TmdbDetail {
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  genres?: Array<{ name: string }>
  runtime?: number | null
  episode_run_time?: number[]
  vote_average?: number
  backdrop_path?: string | null
  images?: {
    logos?: Array<{ file_path: string; iso_639_1: string | null }>
  }
}

/** Hero 命中一部片时显示的内容 */
export interface HeroMatch {
  kind: 'movie' | 'tv'
  tmdbId: number
  title: string
  /** 剧照（宽图） */
  backdrop: string
  /** 片名标志；没有时显示大标题 */
  logo: string | null
  /** 年份 · 类型 · 时长 */
  meta: string[]
  /** 「TMDB 8.3」；没有评分为空串 */
  rating: string
}

/**
 * 搜索词 → 拿去匹配影片的查询词；磁力 / 电驴 / 网址或空串不匹配，返回空串。
 * @param keyword 用户搜索的词
 */
export function matchQuery(keyword: string): string {
  const text = keyword.trim()
  if (!text || /^(magnet:|ed2k:|https?:)/i.test(text)) return ''
  return text.slice(0, MAX_QUERY)
}

/** 比较用的片名：小写，去掉空白和标点（中日韩文字、字母、数字保留） */
export function normalizeTitle(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * 片名和查询词对得上：任一名字与查询词互相包含（至少两个字），防止 TMDB 的模糊结果换掉默认海报。
 * @param query 查询词
 * @param names TMDB 给的中文名、原名
 */
export function titleMatches(
  query: string,
  names: ReadonlyArray<string | undefined>
): boolean {
  const q = normalizeTitle(query)
  if (q.length < 2) return false
  return names.some(name => {
    const n = normalizeTitle(name ?? '')
    return n.length >= 2 && (n.includes(q) || q.includes(n))
  })
}

/**
 * 从 TMDB 多类搜索结果里挑一部：电影或剧集、有剧照、片名对得上，取第一条。
 * @returns 没有合适的为 null
 */
export function pickTmdbHit(
  results: readonly TmdbSearchHit[],
  query: string
): (TmdbSearchHit & { media_type: 'movie' | 'tv' }) | null {
  const hit = results.find(
    item =>
      (item.media_type === 'movie' || item.media_type === 'tv') &&
      Boolean(item.backdrop_path) &&
      titleMatches(query, [
        item.title,
        item.name,
        item.original_title,
        item.original_name,
      ])
  )
  return (hit as TmdbSearchHit & { media_type: 'movie' | 'tv' }) ?? null
}

/** 片名标志：中文优先，其次英文，再其次无文字的 */
function pickLogo(detail: TmdbDetail): string | null {
  const logos = detail.images?.logos ?? []
  const logo =
    logos.find(item => item.iso_639_1 === 'zh') ??
    logos.find(item => item.iso_639_1 === 'en') ??
    logos.find(item => !item.iso_639_1)
  return logo ? `${TMDB_IMAGE}/w500${logo.file_path}` : null
}

/**
 * TMDB 详情 → Hero 内容。
 * @param hit 搜索时挑中的那条（剧照兜底）
 * @param detail 详情（language=zh-CN，append_to_response=images）
 */
export function heroFromTmdb(
  hit: TmdbSearchHit & { media_type: 'movie' | 'tv' },
  detail: TmdbDetail
): HeroMatch | null {
  const backdrop = detail.backdrop_path || hit.backdrop_path
  if (!backdrop) return null
  const kind = hit.media_type
  const date = kind === 'movie' ? detail.release_date : detail.first_air_date
  const minutes =
    kind === 'movie' ? detail.runtime : detail.episode_run_time?.[0]
  const year = /^\d{4}/.exec(date ?? '')?.[0] ?? ''
  const meta = [
    year,
    detail.genres?.[0]?.name ?? '',
    minutes ? `${kind === 'tv' ? '每集 ' : ''}${minutes} 分钟` : '',
  ].filter(Boolean)
  const vote = detail.vote_average ?? 0
  return {
    kind,
    tmdbId: hit.id,
    title: detail.title || detail.name || hit.title || hit.name || '未知影片',
    backdrop: `${TMDB_IMAGE}/w1280${backdrop}`,
    logo: pickLogo(detail),
    meta,
    rating: vote > 0 ? `TMDB ${vote.toFixed(1)}` : '',
  }
}
