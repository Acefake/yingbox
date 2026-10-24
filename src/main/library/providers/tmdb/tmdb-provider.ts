/**
 * TMDB 元数据源：搜索、详情（append_to_response 一次取全）、季详情、剧集分组、外部 ID 反查。
 *
 * 所有请求经 ProviderHttp（限速 / 重试 / 去重 / 缓存）。详情的缓存键与语言、append 参数绑定，
 * 识别时取过的详情在入库时直接命中缓存，不重复请求。
 */
import type {
  Candidate,
  EpisodePosition,
  ExternalIdSource,
  MediaKind,
  MediaMetadata,
  MediaRef,
  MetadataProvider,
  SearchQuery,
  SeasonMetadata,
} from '../../../../shared/library/provider'
import { ProviderAuthError, type ProviderHttp } from '../http/provider-http'
import {
  type TmdbDetails,
  candidateFromDetails,
  candidateFromResult,
  metadataFromDetails,
  seasonFromTmdb,
} from './tmdb-map'
import type {
  TmdbEpisodeGroup,
  TmdbFindResult,
  TmdbMovieResult,
  TmdbPage,
  TmdbSeason,
  TmdbTvDetails,
  TmdbTvResult,
} from './tmdb-types'

export const TMDB_API = 'https://api.themoviedb.org/3'
export const TMDB_IMAGE = 'https://image.tmdb.org/t/p'

const DAY = 86_400_000
/** 缓存时长。 */
export const TMDB_TTL = {
  search: DAY,
  find: 7 * DAY,
  details: 7 * DAY,
  /** 已完结 / 已取消的剧和上映超过一年的电影基本不再变化。 */
  settled: 30 * DAY,
  season: 7 * DAY,
  episodeGroup: 7 * DAY,
  /** 追剧日历的播出信息：每部剧每天最多刷新一次。 */
  airing: DAY,
} as const

/** 剧集分组类型：绝对集数。 */
export const EPISODE_GROUP_ABSOLUTE = 2

const MOVIE_APPEND =
  'credits,images,external_ids,translations,alternative_titles,release_dates'
const TV_APPEND =
  'credits,images,external_ids,translations,alternative_titles,content_ratings,episode_groups'

/** 构造参数。 */
export interface TmdbProviderOptions {
  http: ProviderHttp
  /** 每次请求时读取当前令牌（v4 读访问令牌或 v3 api_key）；未配置返回 undefined。 */
  token: () => string | undefined
  /** 结果语言，默认 zh-CN。 */
  language?: string
  /** 搜索时的第二语言，默认 en-US。 */
  secondaryLanguage?: string
}

/** v4 令牌是 JWT（eyJ 开头），否则按 v3 api_key 处理。 */
const isBearer = (token: string): boolean => token.startsWith('eyJ')

/** 剧集是否已不再更新。 */
const settledTv = (d: TmdbTvDetails | null): boolean =>
  d?.status === 'Ended' || d?.status === 'Canceled'

/** TMDB 元数据源。 */
export class TmdbProvider implements MetadataProvider {
  readonly name = 'tmdb' as const
  readonly language: string
  readonly secondaryLanguage: string

  constructor(private readonly options: TmdbProviderOptions) {
    this.language = options.language ?? 'zh-CN'
    this.secondaryLanguage = options.secondaryLanguage ?? 'en-US'
  }

  /** 是否已配置令牌。 */
  get configured(): boolean {
    return Boolean(this.options.token())
  }

  /**
   * 拼图片 URL；size 如 w300 / w780 / original。
   * path 已是绝对地址（番号站点的图片）时原样返回，写出层 / 识别执行器因此不用区分来源。
   */
  static imageUrl(path: string, size = 'original'): string {
    return /^https?:\/\//.test(path) ? path : `${TMDB_IMAGE}/${size}${path}`
  }

  /**
   * GET 一个 API 路径。缓存键 = 路径 + 排序后的参数（不含令牌）；
   * tag 给同一请求另起一份缓存（追剧日历要按天刷新，不能沿用识别用的 7 天缓存）。
   */
  private get<T>(
    path: string,
    params: Record<string, string | number | undefined>,
    ttl: (body: unknown) => number,
    signal?: AbortSignal,
    tag?: string
  ): Promise<T | null> {
    const token = this.options.token()
    if (!token) {
      return Promise.reject(new ProviderAuthError('未配置 TMDB API 令牌'))
    }
    const query = new URLSearchParams()
    for (const key of Object.keys(params).sort()) {
      const value = params[key]
      if (value !== undefined && value !== '') query.set(key, String(value))
    }
    const cacheKey = `tmdb:${path}?${query}${tag ? `#${tag}` : ''}`
    const bearer = isBearer(token)
    if (!bearer) query.set('api_key', token)
    return this.options.http.getJson<T>({
      url: `${TMDB_API}${path}?${query}`,
      headers: bearer ? { Authorization: `Bearer ${token}` } : {},
      cacheKey,
      ttl,
      signal,
    })
  }

  /** 按标题搜索（单一语言）。 */
  async search(query: SearchQuery, signal?: AbortSignal): Promise<Candidate[]> {
    const movie = query.kind === 'movie'
    const page = await this.get<TmdbPage<TmdbMovieResult | TmdbTvResult>>(
      `/search/${query.kind}`,
      {
        query: query.title,
        language: query.language ?? this.language,
        include_adult: 'false',
        page: 1,
        ...(movie ? { year: query.year } : { first_air_date_year: query.year }),
      },
      () => TMDB_TTL.search,
      signal
    )
    return (page?.results ?? []).map(r => candidateFromResult(query.kind, r))
  }

  /** 原始详情（带 append_to_response）。 */
  async rawDetails(
    kind: MediaKind,
    id: string,
    signal?: AbortSignal
  ): Promise<TmdbDetails | null> {
    if (!/^\d+$/.test(id)) return null
    return this.get<TmdbDetails>(
      `/${kind}/${id}`,
      {
        language: this.language,
        append_to_response: kind === 'movie' ? MOVIE_APPEND : TV_APPEND,
        include_image_language: `${this.language.split('-')[0]},en,null`,
      },
      body => {
        if (kind === 'tv') {
          return settledTv(body as TmdbTvDetails)
            ? TMDB_TTL.settled
            : TMDB_TTL.details
        }
        const date = (body as { release_date?: string } | null)?.release_date
        const old = date && Date.now() - Date.parse(date) > 365 * DAY
        return old ? TMDB_TTL.settled : TMDB_TTL.details
      },
      signal
    )
  }

  /** 详情 → 候选（识别精排用）。 */
  async details(
    kind: MediaKind,
    id: string,
    signal?: AbortSignal
  ): Promise<Candidate | null> {
    const raw = await this.rawDetails(kind, id, signal)
    return raw ? candidateFromDetails(kind, raw) : null
  }

  /** 详情 → 入库元数据。 */
  async metadata(
    ref: MediaRef,
    signal?: AbortSignal
  ): Promise<MediaMetadata | null> {
    const raw = await this.rawDetails(ref.kind, ref.id, signal)
    return raw ? metadataFromDetails(ref.kind, raw, this.language) : null
  }

  /** 按 imdb / tvdb ID 反查。 */
  async find(
    source: ExternalIdSource,
    id: string,
    signal?: AbortSignal
  ): Promise<Candidate[]> {
    const result = await this.get<TmdbFindResult>(
      `/find/${encodeURIComponent(id)}`,
      { external_source: `${source}_id`, language: this.language },
      () => TMDB_TTL.find,
      signal
    )
    return [
      ...(result?.movie_results ?? []).map(r =>
        candidateFromResult('movie', r)
      ),
      ...(result?.tv_results ?? []).map(r => candidateFromResult('tv', r)),
    ]
  }

  /** 一季的详情（含每集）；不存在返回 null。 */
  async season(
    tvId: string,
    season: number,
    signal?: AbortSignal
  ): Promise<SeasonMetadata | null> {
    const raw = await this.get<TmdbSeason>(
      `/tv/${tvId}/season/${season}`,
      { language: this.language },
      body => {
        // 最后一集播出超过半年，这一季基本定型
        const episodes = (body as TmdbSeason | null)?.episodes ?? []
        const last = episodes.at(-1)?.air_date
        const settled = last && Date.now() - Date.parse(last) > 180 * DAY
        return settled ? TMDB_TTL.settled : TMDB_TTL.season
      },
      signal
    )
    return raw ? seasonFromTmdb(raw) : null
  }

  /**
   * 追剧日历用的剧集详情（不带 append，含 next / last_episode_to_air 与各季播出日）。
   * 连载中的剧缓存一天，已完结 / 已取消的按 settled 缓存。
   */
  async airing(
    tvId: string,
    signal?: AbortSignal
  ): Promise<TmdbTvDetails | null> {
    if (!/^\d+$/.test(tvId)) return null
    return this.get<TmdbTvDetails>(
      `/tv/${tvId}`,
      { language: this.language },
      body =>
        settledTv(body as TmdbTvDetails) ? TMDB_TTL.settled : TMDB_TTL.airing,
      signal,
      'airing'
    )
  }

  /** 追剧日历用的季详情（原始形状，含每集播出日与剧照）：最多缓存一天，定型的季按 settled。 */
  async airingSeason(
    tvId: string,
    season: number,
    signal?: AbortSignal
  ): Promise<TmdbSeason | null> {
    if (!/^\d+$/.test(tvId)) return null
    return this.get<TmdbSeason>(
      `/tv/${tvId}/season/${season}`,
      { language: this.language },
      body => {
        const last = (body as TmdbSeason | null)?.episodes?.at(-1)?.air_date
        const settled = last && Date.now() - Date.parse(last) > 180 * DAY
        return settled ? TMDB_TTL.settled : TMDB_TTL.airing
      },
      signal,
      'airing'
    )
  }

  /** 剧集分组详情。 */
  async episodeGroup(
    groupId: string,
    signal?: AbortSignal
  ): Promise<TmdbEpisodeGroup | null> {
    return this.get<TmdbEpisodeGroup>(
      `/tv/episode_group/${encodeURIComponent(groupId)}`,
      { language: this.language },
      () => TMDB_TTL.episodeGroup,
      signal
    )
  }

  /**
   * 绝对集数顺序：第 n 项是绝对第 n+1 集对应的（季, 集）。
   * 有“绝对”类型的剧集分组时按分组顺序；否则按季号把正片季依次拼接（不含特别篇）。
   */
  async absoluteOrder(
    meta: MediaMetadata,
    signal?: AbortSignal
  ): Promise<EpisodePosition[]> {
    const group = meta.episodeGroups
      ?.filter(g => g.type === EPISODE_GROUP_ABSOLUTE)
      .sort((a, b) => b.episodeCount - a.episodeCount)[0]
    if (group) {
      const detail = await this.episodeGroup(group.id, signal)
      const order = (detail?.groups ?? [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .flatMap(g =>
          (g.episodes ?? [])
            .slice()
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map(e => ({ season: e.season_number, episode: e.episode_number }))
        )
      if (order.length) return order
    }
    const out: EpisodePosition[] = []
    for (const s of [...(meta.seasons ?? [])].sort(
      (a, b) => a.season - b.season
    )) {
      if (s.season <= 0) continue
      for (let e = 1; e <= s.episodeCount; e++)
        out.push({ season: s.season, episode: e })
    }
    return out
  }
}
