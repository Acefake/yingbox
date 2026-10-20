/**
 * TMDB 原始响应 → 与元数据源无关的 Candidate / MediaMetadata / SeasonMetadata。
 *
 * 纯函数，不发请求；语言回退、图片排序、分级选择等规则都在这里。
 */
import type { ExternalIds } from '../../../../shared/library/parser'
import type {
  Candidate,
  EpisodeMetadata,
  ImageCandidate,
  ImageRole,
  MediaKind,
  MediaMetadata,
  PersonCredit,
  SeasonMetadata,
} from '../../../../shared/library/provider'
import type {
  TmdbImage,
  TmdbMovieDetails,
  TmdbMovieResult,
  TmdbSeason,
  TmdbTranslation,
  TmdbTvDetails,
  TmdbTvResult,
} from './tmdb-types'

/** 详情（电影或剧集）。 */
export type TmdbDetails = TmdbMovieDetails | TmdbTvDetails

/** 演员表最多保留几位。 */
export const CAST_LIMIT = 15
/** 保留的幕后职务。 */
const CREW_JOBS = new Set([
  'Director',
  'Screenplay',
  'Writer',
  'Story',
  'Novel',
])

/** 'YYYY-MM-DD' → 年份。 */
export function yearOf(date?: string | null): number | undefined {
  const m = date ? /^(\d{4})/.exec(date) : null
  return m ? Number(m[1]) : undefined
}

const nonEmpty = (s?: string | null): string | undefined =>
  s && s.trim() ? s.trim() : undefined

/**
 * 文本语言回退链。中文界面：zh-CN → zh-TW → zh-HK → zh-SG → en-US → 任意 en；
 * 其他语言：自身 → en-US → 任意 en。
 */
export function languageChain(language: string): string[] {
  const chain = language.startsWith('zh')
    ? [language, 'zh-CN', 'zh-TW', 'zh-HK', 'zh-SG', 'en-US', 'en']
    : [language, 'en-US', 'en']
  return [...new Set(chain)]
}

/** 按回退链从 translations 里挑一个非空字段，返回值与所用语言。 */
function pickTranslation(
  translations: TmdbTranslation[] | undefined,
  chain: string[],
  field: (t: TmdbTranslation) => string | undefined
): { value: string; language: string } | undefined {
  if (!translations?.length) return undefined
  for (const tag of chain) {
    const [lang, region] = tag.split('-')
    for (const t of translations) {
      if (t.iso_639_1 !== lang) continue
      if (region && t.iso_3166_1 !== region) continue
      const value = nonEmpty(field(t))
      if (value) return { value, language: `${lang}-${t.iso_3166_1 ?? ''}` }
    }
  }
  return undefined
}

const isMovie = (kind: MediaKind, _d: TmdbDetails): _d is TmdbMovieDetails =>
  kind === 'movie'

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
  }
}

/**
 * 图片排序：语言偏好（海报 / 标志：界面语言 > 英文 > 无文字 > 其他；背景图：无文字优先）
 * → 评分 → 票数 → 宽度。
 */
export function sortImages(
  images: ImageCandidate[],
  language: string
): ImageCandidate[] {
  const primary = language.split('-')[0]
  const rank = (img: ImageCandidate): number => {
    const order =
      img.role === 'backdrop' || img.role === 'still'
        ? [null, primary, 'en']
        : [primary, 'en', null]
    const i = order.indexOf(img.language)
    return i < 0 ? order.length : i
  }
  return [...images].sort(
    (a, b) =>
      a.role.localeCompare(b.role) ||
      rank(a) - rank(b) ||
      b.voteAverage - a.voteAverage ||
      b.voteCount - a.voteCount ||
      b.width - a.width
  )
}

function toImages(
  role: ImageRole,
  list: TmdbImage[] | undefined,
  fallback?: string | null
): ImageCandidate[] {
  // images 没取到（或被语言过滤为空）时，用详情自带的主海报 / 主背景图兜底
  const source = list?.length
    ? list
    : fallback
      ? [{ file_path: fallback, iso_639_1: null }]
      : []
  return source.map(i => ({
    role,
    path: i.file_path,
    language: i.iso_639_1 ?? null,
    width: i.width ?? 0,
    height: i.height ?? 0,
    voteAverage: i.vote_average ?? 0,
    voteCount: i.vote_count ?? 0,
  }))
}

/** 分级：中国大陆优先，其次美国，再其次任意有值的。 */
/** 电影所属系列；没有时返回空对象，便于展开。 */
function collectionOf(
  c: TmdbMovieDetails['belongs_to_collection']
): Pick<MediaMetadata, 'collection'> {
  const name = nonEmpty(c?.name)
  return c && name ? { collection: { id: String(c.id), name } } : {}
}

function certificationOf(kind: MediaKind, d: TmdbDetails): string | undefined {
  const byCountry = new Map<string, string>()
  if (isMovie(kind, d)) {
    for (const r of d.release_dates?.results ?? []) {
      // 院线（type 3）优先，其次任意有值的
      const dates = [...(r.release_dates ?? [])].sort(
        (a, b) => Number(b.type === 3) - Number(a.type === 3)
      )
      const cert = dates.map(x => nonEmpty(x.certification)).find(Boolean)
      if (cert && r.iso_3166_1) byCountry.set(r.iso_3166_1, cert)
    }
  } else {
    for (const r of (d as TmdbTvDetails).content_ratings?.results ?? []) {
      const cert = nonEmpty(r.rating)
      if (cert && r.iso_3166_1) byCountry.set(r.iso_3166_1, cert)
    }
  }
  return (
    byCountry.get('CN') ??
    byCountry.get('US') ??
    byCountry.values().next().value
  )
}

function castOf(d: TmdbDetails): PersonCredit[] {
  return [...(d.credits?.cast ?? [])]
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, CAST_LIMIT)
    .map(c => ({
      id: String(c.id),
      name: c.name ?? '',
      ...(c.original_name && c.original_name !== c.name
        ? { originalName: c.original_name }
        : {}),
      ...(nonEmpty(c.character) ? { character: c.character!.trim() } : {}),
      ...(c.profile_path ? { profilePath: c.profile_path } : {}),
      order: c.order,
    }))
}

function crewOf(kind: MediaKind, d: TmdbDetails): PersonCredit[] {
  const seen = new Set<string>()
  const out: PersonCredit[] = []
  const push = (p: PersonCredit): void => {
    const key = `${p.id}:${p.job}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(p)
  }
  if (!isMovie(kind, d)) {
    for (const c of (d as TmdbTvDetails).created_by ?? []) {
      push({
        id: String(c.id),
        name: c.name ?? '',
        job: 'Creator',
        ...(c.profile_path ? { profilePath: c.profile_path } : {}),
      })
    }
  }
  for (const c of d.credits?.crew ?? []) {
    if (!c.job || !CREW_JOBS.has(c.job)) continue
    push({
      id: String(c.id),
      name: c.name ?? '',
      ...(c.original_name && c.original_name !== c.name
        ? { originalName: c.original_name }
        : {}),
      job: c.job,
      ...(c.profile_path ? { profilePath: c.profile_path } : {}),
    })
  }
  // 导演在前
  return out.sort(
    (a, b) => Number(b.job === 'Director') - Number(a.job === 'Director')
  )
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
