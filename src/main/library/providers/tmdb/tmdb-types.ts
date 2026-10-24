/**
 * TMDB v3 原始响应的类型（只列用到的字段，全部按可缺省处理：TMDB 字段经常为 null 或不出现）。
 */

/** 搜索结果里的电影。 */
export interface TmdbMovieResult {
  id: number
  title?: string
  original_title?: string
  original_language?: string
  release_date?: string
  popularity?: number
  vote_count?: number
  poster_path?: string | null
  overview?: string
}

/** 搜索结果里的剧集。 */
export interface TmdbTvResult {
  id: number
  name?: string
  original_name?: string
  original_language?: string
  first_air_date?: string
  popularity?: number
  vote_count?: number
  poster_path?: string | null
  overview?: string
}

/** 分页结果。 */
export interface TmdbPage<T> {
  page?: number
  results?: T[]
  total_results?: number
}

/** /find 结果。 */
export interface TmdbFindResult {
  movie_results?: TmdbMovieResult[]
  tv_results?: TmdbTvResult[]
}

/** 一张图片。 */
export interface TmdbImage {
  file_path: string
  iso_639_1?: string | null
  width?: number
  height?: number
  vote_average?: number
  vote_count?: number
}

export interface TmdbCast {
  id: number
  name?: string
  original_name?: string
  character?: string
  order?: number
  profile_path?: string | null
}

export interface TmdbCrew {
  id: number
  name?: string
  original_name?: string
  job?: string
  department?: string
  profile_path?: string | null
}

export interface TmdbTranslation {
  iso_3166_1?: string
  iso_639_1?: string
  data?: {
    title?: string
    name?: string
    overview?: string
    tagline?: string
  }
}

export interface TmdbAltTitle {
  iso_3166_1?: string
  title?: string
}

/** 电影和剧集详情共有（含 append_to_response 的部分）。 */
interface TmdbDetailsBase {
  id: number
  original_language?: string
  overview?: string
  tagline?: string
  genres?: Array<{ id: number; name?: string }>
  vote_average?: number
  vote_count?: number
  popularity?: number
  status?: string
  poster_path?: string | null
  backdrop_path?: string | null
  production_countries?: Array<{ iso_3166_1?: string; name?: string }>
  production_companies?: Array<{ id: number; name?: string }>
  credits?: { cast?: TmdbCast[]; crew?: TmdbCrew[] }
  images?: {
    posters?: TmdbImage[]
    backdrops?: TmdbImage[]
    logos?: TmdbImage[]
  }
  external_ids?: {
    imdb_id?: string | null
    tvdb_id?: number | null
  }
  translations?: { translations?: TmdbTranslation[] }
}

/** 电影详情。 */
export interface TmdbMovieDetails extends TmdbDetailsBase {
  title?: string
  original_title?: string
  release_date?: string
  runtime?: number | null
  imdb_id?: string | null
  /** 所属系列（合集）。 */
  belongs_to_collection?: { id: number; name?: string } | null
  alternative_titles?: { titles?: TmdbAltTitle[] }
  release_dates?: {
    results?: Array<{
      iso_3166_1?: string
      release_dates?: Array<{ certification?: string; type?: number }>
    }>
  }
}

/** 剧集详情里的上一集 / 下一集（追剧日历用）。 */
export interface TmdbAiringEpisode {
  season_number: number
  episode_number: number
  name?: string
  air_date?: string | null
  still_path?: string | null
}

/** 剧集详情。 */
export interface TmdbTvDetails extends TmdbDetailsBase {
  /** 最近播出的一集；没播过为 null。 */
  last_episode_to_air?: TmdbAiringEpisode | null
  /** 下一集（已排期）；没有为 null。 */
  next_episode_to_air?: TmdbAiringEpisode | null
  name?: string
  original_name?: string
  first_air_date?: string
  episode_run_time?: number[]
  origin_country?: string[]
  created_by?: Array<{
    id: number
    name?: string
    profile_path?: string | null
  }>
  seasons?: Array<{
    season_number: number
    episode_count?: number
    name?: string
    air_date?: string | null
    poster_path?: string | null
  }>
  alternative_titles?: { results?: TmdbAltTitle[] }
  content_ratings?: {
    results?: Array<{ iso_3166_1?: string; rating?: string }>
  }
  episode_groups?: {
    results?: Array<{
      id: string
      name?: string
      type?: number
      episode_count?: number
    }>
  }
}

/** 季详情。 */
export interface TmdbSeason {
  season_number: number
  name?: string
  overview?: string
  air_date?: string | null
  poster_path?: string | null
  episodes?: Array<{
    season_number: number
    episode_number: number
    name?: string
    overview?: string
    air_date?: string | null
    runtime?: number | null
    vote_average?: number
    still_path?: string | null
  }>
}

/** 剧集分组详情。 */
export interface TmdbEpisodeGroup {
  id: string
  name?: string
  type?: number
  groups?: Array<{
    name?: string
    order?: number
    episodes?: Array<{
      season_number: number
      episode_number: number
      order?: number
    }>
  }>
}
