/** 独立追剧目录：直接从 TMDB 取得剧集身份与分集，不创建媒体库条目。 */
import type {
  TrackCandidate,
  TrackOnlineRequest,
} from '../../shared/contract/autograb'
import { categoryOfGenres } from '../../shared/contract/series-category'
import type {
  CalendarEpisode,
  CalendarRequest,
  CalendarResult,
} from '../../shared/library/ipc'
import type { TmdbGet } from './movies/tmdb'
import type { SeriesSetting } from './state'

/** 创建追剧任务所需的剧集信息。 */
export interface SeriesInfo {
  tmdbId: string
  title: string
  originalTitle: string
  year: number | null
  poster: string | null
  category: NonNullable<SeriesSetting['category']>
}
type Raw = Record<string, unknown>
const object = (v: unknown): v is Raw =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const image = (v: unknown): string | null =>
  text(v).startsWith('/') ? `https://image.tmdb.org/t/p/w500${text(v)}` : null
const date = (v: unknown): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(text(v)) ? text(v) : null
const normalize = (v: string): string => v.replace(/\s/g, '').toLowerCase()

/** 独立 TMDB 目录与按天缓存；请求失败不缓存为空结果。 */
export function createSeriesCatalog(
  get: TmdbGet,
  language: () => string,
  now = Date.now
): {
  resolve(
    request: TrackOnlineRequest
  ): Promise<
    | { status: 'ready'; info: SeriesInfo }
    | { status: 'choose'; candidates: TrackCandidate[] }
    | { status: 'none' }
  >
  info(id: string): Promise<SeriesInfo>
  episodes(
    seriesId: number,
    setting: SeriesSetting,
    range: CalendarRequest
  ): Promise<CalendarEpisode[]>
  calendar(
    range: CalendarRequest,
    tasks: Readonly<Record<string, SeriesSetting>>
  ): Promise<CalendarResult>
} {
  const cache = new Map<string, { day: string; raw: Raw }>()

  async function read(path: string): Promise<Raw> {
    const key = `${language()}:${path}`
    const day = new Date(now()).toISOString().slice(0, 10)
    const hit = cache.get(key)
    if (hit?.day === day) return hit.raw
    const raw = await get(path, { language: language() })
    if (!object(raw))
      throw new Error('无法获取剧集信息，请检查 TMDB 令牌和网络设置')
    cache.set(key, { day, raw })
    return raw
  }

  function metadata(raw: Raw): SeriesInfo {
    if (!Number.isSafeInteger(raw.id) || !text(raw.name))
      throw new Error('TMDB 剧集信息不完整')
    return {
      tmdbId: String(raw.id),
      title: text(raw.name),
      originalTitle: text(raw.original_name),
      year: date(raw.first_air_date)
        ? Number(text(raw.first_air_date).slice(0, 4))
        : null,
      poster: image(raw.poster_path),
      category: categoryOfGenres(
        Array.isArray(raw.genres)
          ? raw.genres.filter(object).map(g => Number(g.id))
          : []
      ),
    }
  }

  async function info(id: string): Promise<SeriesInfo> {
    return metadata(await read(`/tv/${id}`))
  }

  async function episodes(
    seriesId: number,
    setting: SeriesSetting,
    range: CalendarRequest
  ): Promise<CalendarEpisode[]> {
    if (!setting.tmdbId)
      throw new Error(`「${setting.title}」需要重新确认剧集身份`)
    const raw = await read(`/tv/${setting.tmdbId}`)
    const meta = metadata(raw)
    Object.assign(setting, meta)
    const seasons = Array.isArray(raw.seasons) ? raw.seasons.filter(object) : []
    const rows: CalendarEpisode[] = []
    for (const season of seasons) {
      const number = Number(season.season_number)
      if (
        !Number.isSafeInteger(number) ||
        number <= 0 ||
        (date(season.air_date) ?? '0000') > range.to
      )
        continue
      const data = await read(`/tv/${setting.tmdbId}/season/${number}`)
      if (!Array.isArray(data.episodes))
        throw new Error(`「${setting.title}」第 ${number} 季分集信息不完整`)
      for (const episode of data.episodes.filter(object)) {
        const airDate = date(episode.air_date)
        const n = Number(episode.episode_number)
        if (
          !airDate ||
          airDate < range.from ||
          airDate > range.to ||
          !Number.isSafeInteger(n) ||
          n <= 0
        )
          continue
        rows.push({
          seriesId,
          libraryId: 0,
          seriesTitle: meta.title,
          originalTitle: meta.originalTitle || null,
          tmdbId: meta.tmdbId,
          category: meta.category,
          season: number,
          episode: n,
          title: text(episode.name) || null,
          airDate,
          still: image(episode.still_path),
          backdrop: image(raw.backdrop_path),
          poster: meta.poster,
          itemId: null,
          fileId: null,
          filePath: null,
        })
      }
    }
    return rows
  }

  return {
    info,
    episodes,
    async resolve(request) {
      if (request.tmdbId)
        return { status: 'ready', info: await info(request.tmdbId) }
      const raw = await get('/search/tv', {
        language: language(),
        query: request.title,
        ...(request.year ? { first_air_date_year: String(request.year) } : {}),
      })
      if (!object(raw) || !Array.isArray(raw.results))
        throw new Error('无法搜索剧集，请检查 TMDB 令牌和网络设置')
      const candidates: TrackCandidate[] = raw.results
        .filter(object)
        .filter(r => Number.isSafeInteger(r.id) && text(r.name))
        .slice(0, 6)
        .map(r => ({
          id: String(r.id),
          title: text(r.name),
          originalTitle: text(r.original_name),
          poster: image(r.poster_path),
          year: date(r.first_air_date)
            ? Number(text(r.first_air_date).slice(0, 4))
            : null,
        }))
      const exact = candidates.filter(
        c =>
          normalize(c.title) === normalize(request.title) &&
          (!request.year || c.year === request.year)
      )
      if (exact.length === 1)
        return { status: 'ready', info: await info(exact[0].id) }
      return candidates.length
        ? { status: 'choose', candidates }
        : { status: 'none' }
    },
    async calendar(range, tasks) {
      const result: CalendarResult = {
        episodes: [],
        configured: true,
        series: Object.keys(tasks).length,
        failed: 0,
      }
      for (const [id, setting] of Object.entries(tasks)) {
        try {
          result.episodes.push(...(await episodes(Number(id), setting, range)))
        } catch {
          result.failed++
        }
      }
      if (result.failed && result.failed === result.series)
        throw new Error('获取追剧分集失败，请检查 TMDB 设置后重试')
      return result
    },
  }
}
