/**
 * 元数据入库：把 MediaMetadata / SeasonMetadata / EpisodeMetadata 写进 media_items。
 *
 * 常用字段（标题、年份、简介、评分、时长、类型、外部 id、图片地址）各占一列，便于列表查询；
 * 完整元数据（演职员、图片候选、各语言信息等）存 metadata JSON，详情页 / NFO 写出（P5）直接用。
 * 写方法都应在调用方的事务里执行。
 * fillLocal 用本地 NFO / 豆瓣的信息只补空着的字段，不覆盖刮削来的值。
 */
import type { ItemMetadata, MatchState } from '../../../shared/library/ipc'
import type {
  EpisodeMetadata,
  MediaMetadata,
  SeasonMetadata,
} from '../../../shared/library/provider'
import { normalizeTitle } from '../../../shared/library/scoring'
import { type LibraryDb, StatementCache } from '../db/database'

/** 图片地址：已缓存为 yingbox-media://，否则为远程 URL。 */
export interface ItemImages {
  poster?: string | null
  backdrop?: string | null
  logo?: string | null
}

/** 检索文本：本地标题 + 元数据标题 + 原名，归一化后去重。 */
function searchText(titles: Array<string | null | undefined>): string {
  return [
    ...new Set(titles.map(t => (t ? normalizeTitle(t) : '')).filter(Boolean)),
  ].join(' ')
}

/** 本地补全的信息（NFO / 豆瓣）；没有的字段缺省。 */
export interface LocalFill {
  genres?: string[]
  /** ISO 3166-1 两位代码。 */
  countries?: string[]
  rating?: number
  overview?: string
  year?: number
}

/** 列值是否为空（NULL、空串、空 JSON 数组）。 */
const blank = (value: unknown): boolean =>
  value === null || value === undefined || value === '' || value === '[]'

/** 现有元数据里的制片国家为空时，补上 countries 后的新 JSON；不需要改返回 null。 */
function withCountries(
  raw: unknown,
  countries: readonly string[],
  source: 'nfo' | 'douban'
): string | null {
  if (!countries.length) return null
  if (blank(raw)) {
    const local: ItemMetadata = {
      level: 'local',
      countries: [...countries],
      source,
    }
    return JSON.stringify(local)
  }
  let meta: ItemMetadata
  try {
    meta = JSON.parse(String(raw)) as ItemMetadata
  } catch {
    return null
  }
  if (meta.level !== 'title' && meta.level !== 'local') return null
  if (meta.countries?.length) return null
  return JSON.stringify({ ...meta, countries: [...countries] })
}

/** 元数据写入仓库。 */
export class MetadataWriter {
  private readonly sql: StatementCache

  constructor(db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  /**
   * 写电影 / 剧集的元数据与匹配状态。locked 条目保持 locked（state 传入时被忽略）。
   * localTitle 是识别前的本地标题，并进检索文本，用户仍能按文件名里的写法搜到。
   */
  writeTitle(
    itemId: number,
    meta: MediaMetadata,
    state: Extract<MatchState, 'auto' | 'locked'>,
    images: ItemImages,
    now: number
  ): void {
    const row = this.sql
      .get('SELECT title, search_text FROM media_items WHERE id = ?')
      .get(itemId)
    const localTitle = row ? String(row.title) : ''
    const json: ItemMetadata = { level: 'title', ...meta }
    this.sql
      .get(
        `UPDATE media_items SET
           title = ?, original_title = ?, sort_title = ?, search_text = ?, year = ?,
           tmdb_id = ?, imdb_id = ?, tvdb_id = ?, overview = ?,
           poster = ?, backdrop = ?, logo = ?, rating = ?, runtime = ?, genres = ?,
           air_date = ?, metadata = ?, metadata_at = ?, identified_at = ?, updated_at = ?,
           match_state = CASE WHEN match_state = 'locked' THEN 'locked' ELSE ? END
         WHERE id = ?`
      )
      .run(
        meta.title,
        meta.originalTitle ?? null,
        normalizeTitle(meta.title),
        searchText([meta.title, meta.originalTitle, localTitle]),
        meta.year ?? null,
        meta.externalIds.tmdb ?? meta.ref.id,
        meta.externalIds.imdb ?? null,
        meta.externalIds.tvdb ?? null,
        meta.overview ?? null,
        images.poster ?? null,
        images.backdrop ?? null,
        images.logo ?? null,
        meta.rating ?? null,
        meta.runtimeMinutes ?? null,
        JSON.stringify(meta.genres),
        meta.releaseDate ?? null,
        JSON.stringify(json),
        now,
        now,
        now,
        state,
        itemId
      )
  }

  /**
   * 用本地信息补空着的字段：类型、简介、评分、年份各自只在为空时写；制片国家补进 metadata
   * （没有元数据时写 level = local 的小对象）。返回是否有改动。
   * 已是最新识别（identified_at ≥ updated_at）的条目，identified_at 跟着前移，补全不会让它下次扫描重新识别。
   */
  fillLocal(
    itemId: number,
    fill: LocalFill,
    source: 'nfo' | 'douban',
    now: number
  ): boolean {
    const row = this.sql
      .get(
        'SELECT genres, overview, rating, year, metadata FROM media_items WHERE id = ?'
      )
      .get(itemId)
    if (!row) return false
    const genres =
      fill.genres?.length && blank(row.genres)
        ? JSON.stringify(fill.genres)
        : null
    const overview = fill.overview && blank(row.overview) ? fill.overview : null
    const rating =
      fill.rating !== undefined && blank(row.rating) ? fill.rating : null
    const year = fill.year !== undefined && blank(row.year) ? fill.year : null
    const metadata = withCountries(row.metadata, fill.countries ?? [], source)
    if (
      genres === null &&
      overview === null &&
      rating === null &&
      year === null &&
      metadata === null
    )
      return false
    this.sql
      .get(
        `UPDATE media_items SET genres = COALESCE(?1, genres),
           overview = COALESCE(?2, overview), rating = COALESCE(?3, rating),
           year = COALESCE(?4, year), metadata = COALESCE(?5, metadata),
           identified_at = CASE WHEN identified_at >= updated_at THEN ?6
             ELSE identified_at END,
           updated_at = ?6
         WHERE id = ?7`
      )
      .run(genres, overview, rating, year, metadata, now, itemId)
    return true
  }

  /** 只更新图片地址（图片缓存完成后替换远程地址）。 */
  writeImages(itemId: number, images: ItemImages): void {
    this.sql
      .get(
        `UPDATE media_items SET poster = COALESCE(?, poster),
           backdrop = COALESCE(?, backdrop), logo = COALESCE(?, logo)
         WHERE id = ?`
      )
      .run(
        images.poster ?? null,
        images.backdrop ?? null,
        images.logo ?? null,
        itemId
      )
  }

  /** 写一季。 */
  writeSeason(
    itemId: number,
    season: SeasonMetadata,
    poster: string | null,
    now: number
  ): void {
    const { episodes: _episodes, ...rest } = season
    const json: ItemMetadata = { level: 'season', ...rest }
    this.sql
      .get(
        `UPDATE media_items SET title = ?, overview = ?, poster = ?, air_date = ?,
           metadata = ?, metadata_at = ?, match_state = 'auto'
         WHERE id = ?`
      )
      .run(
        season.name,
        season.overview ?? null,
        poster,
        season.airDate ?? null,
        JSON.stringify(json),
        now,
        itemId
      )
  }

  /** 写一集；mapped 表示由绝对集数映射而来。 */
  writeEpisode(
    itemId: number,
    episode: EpisodeMetadata,
    still: string | null,
    mapped: boolean,
    now: number
  ): void {
    const json: ItemMetadata = {
      level: 'episode',
      ...episode,
      ...(mapped ? { mapped: true } : {}),
    }
    this.sql
      .get(
        `UPDATE media_items SET title = ?, overview = ?, poster = ?, air_date = ?,
           rating = ?, runtime = ?, metadata = ?, metadata_at = ?, match_state = 'auto'
         WHERE id = ?`
      )
      .run(
        episode.title,
        episode.overview ?? null,
        still,
        episode.airDate ?? null,
        episode.rating ?? null,
        episode.runtimeMinutes ?? null,
        JSON.stringify(json),
        now,
        itemId
      )
  }

  /** 清掉季 / 集上的元数据（剧集改配或在新剧里找不到这一集时）。 */
  clearChild(itemId: number): void {
    this.sql
      .get(
        `UPDATE media_items SET overview = NULL, poster = NULL, air_date = NULL,
           rating = NULL, runtime = NULL, metadata = NULL, metadata_at = NULL,
           match_state = 'unmatched'
         WHERE id = ?`
      )
      .run(itemId)
  }

  /** 清掉顶层条目的元数据（改判为待确认 / 未匹配时）；标题保留当前值。 */
  clearTitle(itemId: number, now: number): void {
    this.sql
      .get(
        `UPDATE media_items SET overview = NULL, poster = NULL, backdrop = NULL,
           logo = NULL, rating = NULL, runtime = NULL, genres = NULL, air_date = NULL,
           metadata = NULL, metadata_at = NULL, updated_at = ?
         WHERE id = ? AND match_state <> 'locked'`
      )
      .run(now, itemId)
  }
}
