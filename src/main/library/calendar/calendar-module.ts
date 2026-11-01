/**
 * 追剧日历（RPC calendar.episodes）：剧集库里已匹配 TMDB 的剧，列出某段日期内播出的每一集。
 *
 * 每部剧先取剧集详情（TmdbProvider.airing，含 next / last_episode_to_air 与各季首播日），
 * 再按 seasonsToFetch 拉相关季的详情取每集 air_date 与剧照。两者都走 ProviderHttp 的限速与
 * provider_cache 缓存，连载中的剧每天最多向 TMDB 刷新一次；季详情失败时退回上一集 / 下一集。
 * 本地有没有这一集、第一个视频文件是哪个，从数据库里查。
 */
import { categoryOfGenres } from '../../../shared/contract/series-category'
import type {
  CalendarEpisode,
  CalendarRequest,
  CalendarResult,
} from '../../../shared/library/ipc'
import { type LibraryDb, StatementCache } from '../db/database'
import { TmdbProvider } from '../providers/tmdb/tmdb-provider'
import {
  type AiredEpisode,
  compareCalendarEpisodes,
  episodeKey,
  episodesInRange,
  fallbackEpisodes,
  seasonsToFetch,
} from './calendar-rules'

/** 同时处理几部剧（真正的并发与限速由 ProviderHttp 控制）。 */
const SERIES_CONCURRENCY = 4
/** 剧照尺寸。 */
const STILL_SIZE = 'w780'

/** 用到的 TMDB 能力（测试可注入假实现）。 */
export type CalendarProvider = Pick<
  TmdbProvider,
  'configured' | 'airing' | 'airingSeason'
>

/** 构造参数。 */
export interface CalendarModuleOptions {
  db: LibraryDb
  provider: () => CalendarProvider
  log?: (message: string) => void
}

/** 参与日历的一部剧。 */
interface SeriesRow {
  id: number
  libraryId: number
  title: string
  originalTitle: string | null
  tmdbId: string
  backdrop: string | null
  poster: string | null
}

/** 本地的一集。 */
interface LocalEpisode {
  itemId: number
  fileId: number | null
  filePath: string | null
}

/**
 * 参与日历的剧：已确认匹配的剧；同一部剧在几个文件夹里（同 merge_key）只取 id 最小的一个，
 * 它的本地集由 MEMBERS_SQL 找全。
 */
const SERIES_SQL = `SELECT i.id, i.library_id, i.title, i.original_title, i.tmdb_id,
    i.backdrop, i.poster
  FROM media_items i JOIN libraries l ON l.id = i.library_id
  WHERE i.type = 'series' AND (l.kind = 'tv' OR l.mixed = 1) AND i.tmdb_id IS NOT NULL
    AND i.match_state IN ('auto', 'locked')
    AND (i.merge_key IS NULL OR NOT EXISTS (
      SELECT 1 FROM media_items o JOIN libraries lo ON lo.id = o.library_id
      WHERE o.merge_key = i.merge_key AND o.id < i.id AND lo.source = l.source
        AND (lo.kind = 'tv' OR lo.mixed = 1)))`

/** 与这部剧合并展示的本地条目（含自身）。 */
const MEMBERS_SQL = `SELECT ?1 AS id UNION
  SELECT m.id FROM media_items i JOIN libraries li ON li.id = i.library_id
  JOIN media_items m ON m.merge_key = i.merge_key
  JOIN libraries l ON l.id = m.library_id AND l.source = li.source
    AND (l.kind = 'tv' OR l.mixed = 1)
  WHERE i.id = ?1`

/** 这些剧下的集（集可能挂在季下，也可能直接挂在剧下），带第一个视频文件。 */
const EPISODES_SQL = `SELECT e.id, e.season_number, e.episode_number,
    (SELECT f.id FROM file_media fm JOIN files f ON f.id = fm.file_id
      WHERE fm.item_id = e.id AND f.kind = 'video' ORDER BY f.path LIMIT 1) AS file_id,
    (SELECT f.path FROM file_media fm JOIN files f ON f.id = fm.file_id
      WHERE fm.item_id = e.id AND f.kind = 'video' ORDER BY f.path LIMIT 1) AS file_path
  FROM media_items e
  WHERE e.type = 'episode' AND e.season_number IS NOT NULL
    AND e.episode_number IS NOT NULL
    AND (e.parent_id IN (SELECT value FROM json_each(?1))
      OR e.parent_id IN (SELECT id FROM media_items
        WHERE parent_id IN (SELECT value FROM json_each(?1)) AND type = 'season'))`

/** 追剧日历。 */
export class CalendarModule {
  private readonly sql: StatementCache
  private readonly log: (message: string) => void

  constructor(private readonly options: CalendarModuleOptions) {
    this.sql = new StatementCache(options.db)
    this.log = options.log ?? (() => {})
  }

  /** 区间内播出的集。 */
  async episodes(request: CalendarRequest): Promise<CalendarResult> {
    const provider = this.options.provider()
    const series = this.listSeries()
    if (!provider.configured)
      return {
        episodes: [],
        configured: false,
        series: series.length,
        failed: 0,
      }
    const episodes: CalendarEpisode[] = []
    let failed = 0
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < series.length) {
        const row = series[next++]
        try {
          episodes.push(...(await this.forSeries(provider, row, request)))
        } catch (error) {
          failed++
          this.log(
            `[calendar] ${row.title}（tmdb ${row.tmdbId}）播出信息获取失败：${String(error)}`
          )
        }
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(SERIES_CONCURRENCY, series.length) },
        worker
      )
    )
    episodes.sort(compareCalendarEpisodes)
    return { episodes, configured: true, series: series.length, failed }
  }

  private listSeries(): SeriesRow[] {
    return this.sql
      .get(SERIES_SQL)
      .all()
      .map(row => ({
        id: Number(row.id),
        libraryId: Number(row.library_id),
        title: String(row.title),
        originalTitle: originalOf(row.original_title, String(row.title)),
        tmdbId: String(row.tmdb_id),
        backdrop: row.backdrop === null ? null : String(row.backdrop),
        poster: row.poster === null ? null : String(row.poster),
      }))
  }

  private localEpisodes(seriesId: number): Map<string, LocalEpisode> {
    const out = new Map<string, LocalEpisode>()
    const members = this.sql
      .get(MEMBERS_SQL)
      .all(seriesId)
      .map(r => Number(r.id))
    const rows = this.sql.get(EPISODES_SQL).all(JSON.stringify(members))
    for (const row of rows) {
      const key = episodeKey(
        Number(row.season_number),
        Number(row.episode_number)
      )
      const found = out.get(key)
      // 同一集多个条目（多版本、几个文件夹各有一份）时优先有文件的
      if (found?.fileId) continue
      out.set(key, {
        itemId: Number(row.id),
        fileId: row.file_id === null ? null : Number(row.file_id),
        filePath: row.file_path === null ? null : String(row.file_path),
      })
    }
    return out
  }

  /** 一部剧在区间内的集。 */
  private async forSeries(
    provider: CalendarProvider,
    row: SeriesRow,
    range: CalendarRequest
  ): Promise<CalendarEpisode[]> {
    const details = await provider.airing(row.tmdbId)
    if (!details) return []
    const aired: AiredEpisode[] = []
    const fetched = new Set<number>()
    for (const season of seasonsToFetch(details, range)) {
      try {
        const raw = await provider.airingSeason(row.tmdbId, season)
        if (!raw) continue
        fetched.add(season)
        aired.push(...episodesInRange(raw, range))
      } catch (error) {
        this.log(
          `[calendar] ${row.title} 第 ${season} 季获取失败：${String(error)}`
        )
      }
    }
    aired.push(...fallbackEpisodes(details, range, fetched))
    if (!aired.length) return []
    const local = this.localEpisodes(row.id)
    return aired.map(ep => {
      const mine = local.get(episodeKey(ep.season, ep.episode))
      return {
        seriesId: row.id,
        libraryId: row.libraryId,
        seriesTitle: row.title,
        originalTitle: row.originalTitle,
        tmdbId: row.tmdbId,
        category: categoryOfGenres((details.genres ?? []).map(g => g.id)),
        season: ep.season,
        episode: ep.episode,
        title: ep.title,
        airDate: ep.airDate,
        still: ep.stillPath
          ? TmdbProvider.imageUrl(ep.stillPath, STILL_SIZE)
          : null,
        backdrop: row.backdrop,
        poster: row.poster,
        itemId: mine?.itemId ?? null,
        fileId: mine?.fileId ?? null,
        filePath: mine?.filePath ?? null,
      }
    })
  }
}

/** 原名：空或与剧名相同时为 null */
function originalOf(value: unknown, title: string): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && text !== title ? text : null
}
