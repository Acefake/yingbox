/**
 * 电影上线追踪用到的 TMDB：按片名搜电影、取一部电影的片名 / 年份 / 海报 / 首映日 / 各国发行日期。
 *
 * 只做解析；请求由 index.ts 注入（主进程带令牌直连 TMDB v3，见 ../../recap 的同款写法）。
 * 返回内容在这里逐字段校验，认不出的丢掉。
 */
import type { MovieSearchHit } from '../../../shared/contract/autograb-upgrade'
import type { ReleaseDate } from './movie-rules'

const IMAGE_BASE = 'https://image.tmdb.org/t/p/w342'

/** 一部电影的 TMDB 信息 */
export interface MovieInfo {
  tmdbId: number
  title: string
  originalTitle: string
  year: number | null
  poster: string | null
  /** 首映日 YYYY-MM-DD；没有为 null */
  premiere: string | null
  releaseDates: ReleaseDate[]
}

/** GET 一个 TMDB v3 路径；没配令牌返回 null，失败抛错 */
export type TmdbGet = (
  path: string,
  query: Record<string, string>
) => Promise<unknown>

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const dateOf = (v: unknown): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(text(v))
  return m ? m[1] : null
}
const posterOf = (v: unknown): string | null =>
  text(v) ? `${IMAGE_BASE}${text(v)}` : null
const yearOf = (date: string | null): number | null =>
  date ? Number(date.slice(0, 4)) : null

/** /movie/{id}?append_to_response=release_dates 的返回 → MovieInfo；不像样时为 null */
export function parseMovie(raw: unknown): MovieInfo | null {
  if (!isObj(raw) || typeof raw.id !== 'number') return null
  const title = text(raw.title) || text(raw.original_title)
  if (!title) return null
  const premiere = dateOf(raw.release_date)
  const releaseDates: ReleaseDate[] = []
  const results = isObj(raw.release_dates) ? raw.release_dates.results : null
  if (Array.isArray(results))
    for (const country of results) {
      if (!isObj(country) || !Array.isArray(country.release_dates)) continue
      for (const d of country.release_dates) {
        const date = isObj(d) ? dateOf(d.release_date) : null
        if (date && isObj(d) && typeof d.type === 'number')
          releaseDates.push({ type: d.type, date })
      }
    }
  return {
    tmdbId: raw.id,
    title,
    originalTitle: text(raw.original_title),
    year: yearOf(premiere),
    poster: posterOf(raw.poster_path),
    premiere,
    releaseDates,
  }
}

/** /search/movie 的返回 → 搜索结果（最多 10 条） */
export function parseSearch(raw: unknown): MovieSearchHit[] {
  const results = isObj(raw) && Array.isArray(raw.results) ? raw.results : []
  return results
    .filter(isObj)
    .filter(
      r => typeof r.id === 'number' && (text(r.title) || text(r.original_title))
    )
    .slice(0, 10)
    .map(r => ({
      tmdbId: r.id as number,
      title: text(r.title) || text(r.original_title),
      year: yearOf(dateOf(r.release_date)),
      poster: posterOf(r.poster_path),
    }))
}

/** TMDB 电影接口 */
export interface MovieTmdb {
  /** 没配令牌时为 null */
  movie(tmdbId: number): Promise<MovieInfo | null>
  search(query: string): Promise<MovieSearchHit[]>
}

/** 用注入的 GET 组装 TMDB 电影接口；语言读设置 `scrape.metadataLanguage`（缺省 zh-CN） */
export function createMovieTmdb(
  get: TmdbGet,
  language: () => string = () => 'zh-CN'
): MovieTmdb {
  return {
    async movie(tmdbId) {
      const raw = await get(`/movie/${tmdbId}`, {
        language: language(),
        append_to_response: 'release_dates',
      })
      return raw === null ? null : parseMovie(raw)
    },
    async search(query) {
      const q = query.trim()
      if (!q) return []
      return parseSearch(
        await get('/search/movie', { language: language(), query: q })
      )
    },
  }
}
