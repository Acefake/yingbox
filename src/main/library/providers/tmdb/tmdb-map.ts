/**
 * TMDB 原始响应 → 与元数据源无关的 Candidate / MediaMetadata / SeasonMetadata。
 *
 * 纯函数，不发请求；语言回退、图片排序、分级选择等规则都在这里。
 */
import type { ExternalIds } from '../../../../shared/library/parser'
import type {
  Candidate,
  EpisodeMetadata,
  MediaKind,
  MediaMetadata,
  SeasonMetadata,
} from '../../../../shared/library/provider'
import { castOf, certificationOf, crewOf } from './tmdb-credits'
import { sortImages, toImages } from './tmdb-images'
import {
  type TmdbDetails,
  isMovie,
  languageChain,
  nonEmpty,
  pickTranslation,
  yearOf,
} from './tmdb-text'
import type {
  TmdbMovieDetails,
  TmdbMovieResult,
  TmdbSeason,
  TmdbTvDetails,
  TmdbTvResult,
} from './tmdb-types'

export { CAST_LIMIT } from './tmdb-credits'
export { sortImages } from './tmdb-images'
export { type TmdbDetails, languageChain, yearOf } from './tmdb-text'

/** 详情里的全部译名与别名（去重，不含主标题）。 */
function titlesOf(
  kind: MediaKind,
  d: TmdbDetails
): {
  alternativeTitles: string[]
  translations: string[]
} {
  const alt = isMovie(kind, d)
    ? (d.alternative_titles?.titles ?? [])
    : ((d as TmdbTvDetails).alternative_titles?.results ?? [])
  const trans = d.translations?.translations ?? []
  return {
    alternativeTitles: [
      ...new Set(alt.map(a => nonEmpty(a.title)).filter(Boolean) as string[]),
    ],
    translations: [
      ...new Set(
        trans
          .map(t => nonEmpty(t.data?.title ?? t.data?.name))
          .filter(Boolean) as string[]
      ),
    ],
  }
}

/** 搜索 / find 结果 → 候选。 */
export function candidateFromResult(
  kind: MediaKind,
  r: TmdbMovieResult | TmdbTvResult
): Candidate {
  const movie = kind === 'movie'
  const m = r as TmdbMovieResult
  const t = r as TmdbTvResult
  const title = (movie ? m.title : t.name) ?? ''
  const original = movie ? m.original_title : t.original_name
  return {
    ref: { provider: 'tmdb', kind, id: String(r.id) },
    title,
    ...(original && original !== title ? { originalTitle: original } : {}),
    year: yearOf(movie ? m.release_date : t.first_air_date),
    popularity: r.popularity,
    ...(r.poster_path ? { posterPath: r.poster_path } : {}),
    ...(nonEmpty(r.overview) ? { overview: r.overview!.trim() } : {}),
  }
}

/** 详情 → 候选（带全部别名、译名、时长、各季集数，供精排与校验）。 */
export function candidateFromDetails(
  kind: MediaKind,
  d: TmdbDetails
): Candidate {
  const movie = isMovie(kind, d)
  const tv = d as TmdbTvDetails
  const title = (movie ? d.title : tv.name) ?? ''
  const original = movie ? d.original_title : tv.original_name
  const { alternativeTitles, translations } = titlesOf(kind, d)
  const runtime = movie ? (d.runtime ?? undefined) : undefined
  return {
    ref: { provider: 'tmdb', kind, id: String(d.id) },
    title,
    ...(original && original !== title ? { originalTitle: original } : {}),
    alternativeTitles,
    translations,
    year: yearOf(movie ? d.release_date : tv.first_air_date),
    ...(runtime ? { runtimeMinutes: runtime } : {}),
    ...(movie
      ? {}
      : {
          seasons: (tv.seasons ?? []).map(s => ({
            season: s.season_number,
            episodeCount: s.episode_count ?? 0,
          })),
        }),
    popularity: d.popularity,
    ...(d.poster_path ? { posterPath: d.poster_path } : {}),
    ...(nonEmpty(d.overview) ? { overview: d.overview!.trim() } : {}),
  }
}

/** 电影所属系列；没有时返回空对象，便于展开。 */
function collectionOf(
  c: TmdbMovieDetails['belongs_to_collection']
): Pick<MediaMetadata, 'collection'> {
  const name = nonEmpty(c?.name)
  return c && name ? { collection: { id: String(c.id), name } } : {}
}

/** 详情 → 入库元数据。 */
export function metadataFromDetails(
  kind: MediaKind,
  d: TmdbDetails,
  language: string
): MediaMetadata {
  const movie = isMovie(kind, d)
  const tv = d as TmdbTvDetails
  const chain = languageChain(language)
  const translations = d.translations?.translations
  const ownTitle = nonEmpty(movie ? d.title : tv.name)
  const original = nonEmpty(movie ? d.original_title : tv.original_name)
  const title =
    pickTranslation(translations, chain, t => t.data?.title ?? t.data?.name)
      ?.value ??
    ownTitle ??
    original ??
    ''
  const overview = pickTranslation(translations, chain, t => t.data?.overview)
  const tagline = pickTranslation(translations, chain, t => t.data?.tagline)
  const releaseDate = nonEmpty(movie ? d.release_date : tv.first_air_date)
  const runtime = movie
    ? (d.runtime ?? undefined)
    : tv.episode_run_time?.find(n => n > 0)
  const imdb =
    nonEmpty(movie ? d.imdb_id : undefined) ?? nonEmpty(d.external_ids?.imdb_id)
  const externalIds: ExternalIds = { tmdb: String(d.id) }
  if (imdb) externalIds.imdb = imdb
  if (d.external_ids?.tvdb_id) externalIds.tvdb = String(d.external_ids.tvdb_id)
  const countries = movie
    ? (d.production_countries ?? []).map(c => c.iso_3166_1).filter(Boolean)
    : (tv.origin_country ?? [])

  return {
    ref: { provider: 'tmdb', kind, id: String(d.id) },
    title,
    ...(original && original !== title ? { originalTitle: original } : {}),
    ...(d.original_language ? { originalLanguage: d.original_language } : {}),
    year: yearOf(releaseDate),
    ...(releaseDate ? { releaseDate } : {}),
    ...(overview
      ? { overview: overview.value, overviewLanguage: overview.language }
      : nonEmpty(d.overview)
        ? { overview: d.overview!.trim(), overviewLanguage: language }
        : {}),
    ...(tagline ? { tagline: tagline.value } : {}),
    genres: (d.genres ?? []).map(g => g.name ?? '').filter(Boolean),
    ...(d.vote_count
      ? { rating: d.vote_average, voteCount: d.vote_count }
      : {}),
    ...(runtime ? { runtimeMinutes: runtime } : {}),
    countries: countries as string[],
    companies: (d.production_companies ?? [])
      .map(c => c.name ?? '')
      .filter(Boolean),
    ...(certificationOf(kind, d)
      ? { certification: certificationOf(kind, d) }
      : {}),
    cast: castOf(d),
    crew: crewOf(kind, d),
    images: sortImages(
      [
        ...toImages('poster', d.images?.posters, d.poster_path),
        ...toImages('backdrop', d.images?.backdrops, d.backdrop_path),
        ...toImages('logo', d.images?.logos),
      ],
      language
    ),
    externalIds,
    ...(d.status ? { status: d.status } : {}),
    ...collectionOf(movie ? d.belongs_to_collection : undefined),
    ...(movie
      ? {}
      : {
          seasons: (tv.seasons ?? []).map(s => ({
            season: s.season_number,
            name: s.name ?? '',
            episodeCount: s.episode_count ?? 0,
            ...(s.air_date ? { airDate: s.air_date } : {}),
            ...(s.poster_path ? { posterPath: s.poster_path } : {}),
          })),
          episodeGroups: (tv.episode_groups?.results ?? []).map(g => ({
            id: g.id,
            type: g.type ?? 0,
            name: g.name ?? '',
            episodeCount: g.episode_count ?? 0,
          })),
        }),
  }
}

/** 季详情 → 季元数据。 */
export function seasonFromTmdb(s: TmdbSeason): SeasonMetadata {
  return {
    season: s.season_number,
    name: s.name ?? '',
    ...(nonEmpty(s.overview) ? { overview: s.overview!.trim() } : {}),
    ...(s.air_date ? { airDate: s.air_date } : {}),
    ...(s.poster_path ? { posterPath: s.poster_path } : {}),
    episodes: (s.episodes ?? []).map(
      (e): EpisodeMetadata => ({
        season: e.season_number,
        episode: e.episode_number,
        title: e.name ?? '',
        ...(nonEmpty(e.overview) ? { overview: e.overview!.trim() } : {}),
        ...(e.air_date ? { airDate: e.air_date } : {}),
        ...(e.runtime ? { runtimeMinutes: e.runtime } : {}),
        ...(e.vote_average ? { rating: e.vote_average } : {}),
        ...(e.still_path ? { stillPath: e.still_path } : {}),
      })
    ),
  }
}
