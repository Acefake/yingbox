/**
 * 追剧日历在引擎侧的纯规则：一部剧要拉哪几季、季详情里哪些集落在查询区间内、结果怎么排序。
 *
 * 日期都是 YYYY-MM-DD 字符串，按字典序比较即按日期比较。不依赖数据库与网络，测试直接喂 TMDB 形状。
 */
import type { CalendarEpisode } from '../../../shared/library/ipc'
import type {
  TmdbAiringEpisode,
  TmdbSeason,
  TmdbTvDetails,
} from '../providers/tmdb/tmdb-types'

/** 查询区间（闭区间）。 */
export interface DateRange {
  from: string
  to: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 合法的 YYYY-MM-DD；TMDB 偶尔给空串或 null。 */
export const validDate = (value: string | null | undefined): value is string =>
  typeof value === 'string' && DATE_RE.test(value)

const inRange = (date: string, range: DateRange): boolean =>
  date >= range.from && date <= range.to

/**
 * 要拉取的季号（正片季，不含第 0 季特别篇）：
 * 第 n 季覆盖 [第 n 季首播日, 下一季首播日)，与查询区间相交才拉；
 * 另外加上 last / next_episode_to_air 落在区间内的那一季（季首播日缺失时靠它兜底）。
 * 已完结 / 已取消且最后一集早于区间开始的剧一季也不拉。
 */
export function seasonsToFetch(
  details: TmdbTvDetails,
  range: DateRange
): number[] {
  const last = details.last_episode_to_air
  const ended = details.status === 'Ended' || details.status === 'Canceled'
  if (ended && (!validDate(last?.air_date) || last.air_date < range.from))
    return []
  const seasons = (details.seasons ?? [])
    .filter(s => s.season_number > 0 && validDate(s.air_date))
    .sort((a, b) => a.season_number - b.season_number)
  const picked = new Set<number>()
  seasons.forEach((season, i) => {
    const start = season.air_date as string
    const nextStart = seasons[i + 1]?.air_date as string | undefined
    // 区间 [start, nextStart) 与 [from, to] 相交
    if (start <= range.to && (!nextStart || nextStart > range.from))
      picked.add(season.season_number)
  })
  for (const ep of [last, details.next_episode_to_air]) {
    if (ep && ep.season_number > 0 && validDate(ep.air_date))
      if (inRange(ep.air_date, range)) picked.add(ep.season_number)
  }
  return [...picked].sort((a, b) => a - b)
}

/** 日历里一集的 TMDB 部分（本地文件、剧名等由调用方补上）。 */
export interface AiredEpisode {
  season: number
  episode: number
  title: string | null
  airDate: string
  stillPath: string | null
}

const fromTmdb = (ep: {
  season_number: number
  episode_number: number
  name?: string
  air_date?: string | null
  still_path?: string | null
}): AiredEpisode => ({
  season: ep.season_number,
  episode: ep.episode_number,
  title: ep.name?.trim() || null,
  airDate: ep.air_date as string,
  stillPath: ep.still_path || null,
})

/** 季详情里落在区间内的集。 */
export function episodesInRange(
  season: TmdbSeason,
  range: DateRange
): AiredEpisode[] {
  return (season.episodes ?? [])
    .filter(ep => validDate(ep.air_date) && inRange(ep.air_date, range))
    .map(fromTmdb)
}

/**
 * 季详情拉取失败时的兜底：只用剧集详情里的上一集 / 下一集。
 * fetched 是已经拿到季详情的季号，那些季不再重复给。
 */
export function fallbackEpisodes(
  details: TmdbTvDetails,
  range: DateRange,
  fetched: ReadonlySet<number>
): AiredEpisode[] {
  const out: AiredEpisode[] = []
  const candidates: Array<TmdbAiringEpisode | null | undefined> = [
    details.last_episode_to_air,
    details.next_episode_to_air,
  ]
  for (const ep of candidates) {
    if (!ep || fetched.has(ep.season_number) || !validDate(ep.air_date))
      continue
    if (!inRange(ep.air_date, range)) continue
    if (
      out.some(
        o => o.season === ep.season_number && o.episode === ep.episode_number
      )
    )
      continue
    out.push(fromTmdb(ep))
  }
  return out
}

/** 本地剧集键：季 + 集。 */
export const episodeKey = (season: number, episode: number): string =>
  `${season}x${episode}`

/** 结果排序：播出日期 → 剧名 → 季 → 集。 */
export function compareCalendarEpisodes(
  a: CalendarEpisode,
  b: CalendarEpisode
): number {
  return (
    a.airDate.localeCompare(b.airDate) ||
    a.seriesTitle.localeCompare(b.seriesTitle, 'zh-Hans-CN') ||
    a.seriesId - b.seriesId ||
    a.season - b.season ||
    a.episode - b.episode
  )
}
