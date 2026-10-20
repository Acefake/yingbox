/**
 * 由入库元数据生成 NFO（movie / tvshow / season / episodedetails）。
 *
 * 写法取 Kodi、Jellyfin、Emby 三家都能读的交集，并补上各家的旧字段：
 * - id：`<uniqueid type="tmdb" default="true">` + imdb / tvdb（Kodi 17+、Jellyfin、Emby 4.x），
 *   另写 `<tmdbid>` / `<imdbid>` / `<tvdbid>`（Emby 旧版与不少工具只认这些）；
 * - 评分：`<ratings><rating name="themoviedb" default="true">`（Kodi / Jellyfin）+ 顶层 `<rating>`（Emby）；
 * - 分级写 `<mpaa>`，三家都读；国家写中文名（Kodi 直接显示该文本）；
 * - 剧集季名写进 tvshow.nfo 的 `<namedseason>`（Kodi 不读 season.nfo），同时另写 season.nfo（Jellyfin / Emby）；
 * - `<thumb>` / `<fanart>` 给出 TMDB 原图地址，本地图片缺失时播放器可以自己下载。
 * 字段顺序固定，快照测试据此比对。
 */
import type {
  EpisodeMetadata,
  MediaMetadata,
  PersonCredit,
  SeasonMetadata,
} from '../../../../shared/library/provider'
import { TmdbProvider } from '../../providers/tmdb/tmdb-provider'
import { XML_DECLARATION, type XmlNode, el, group, renderNode } from './xml'

/** 编剧类职务。 */
const WRITER_JOBS = new Set([
  'Screenplay',
  'Writer',
  'Novel',
  'Story',
  'Teleplay',
  'Author',
])

const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' })

/** ISO 国家码 → 中文名；不认识的原样返回。 */
function countryName(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

const isPresent = <T>(v: T | undefined): v is T => v !== undefined

/** 评分保留一位小数。 */
const ratingText = (r: number | undefined): string | undefined =>
  r === undefined || !Number.isFinite(r) ? undefined : r.toFixed(1)

/** `<ratings>` + 顶层 `<rating>`。 */
function ratings(rating?: number, votes?: number): Array<XmlNode | undefined> {
  const value = ratingText(rating)
  if (!value) return []
  return [
    group('ratings', [
      group('rating', [el('value', value), el('votes', votes)], {
        name: 'themoviedb',
        max: 10,
        default: true,
      }),
    ]),
    el('rating', value),
  ]
}

/** 外部 id：uniqueid 三种 + 旧式标签。 */
function ids(meta: MediaMetadata): Array<XmlNode | undefined> {
  const tmdb = meta.externalIds.tmdb ?? meta.ref.id
  const { imdb, tvdb } = meta.externalIds
  return [
    el('uniqueid', tmdb, { type: 'tmdb', default: true }),
    el('uniqueid', imdb, { type: 'imdb' }),
    el('uniqueid', tvdb, { type: 'tvdb' }),
    el('tmdbid', tmdb),
    el('imdbid', imdb),
    el('tvdbid', tvdb),
  ]
}

/** 首选的某类图片的原图地址。 */
function imageOf(
  meta: MediaMetadata,
  role: 'poster' | 'backdrop' | 'logo'
): string | undefined {
  const image = meta.images.find(
    i => i.role === role && (role !== 'logo' || !/\.svg$/i.test(i.path))
  )
  return image ? TmdbProvider.imageUrl(image.path) : undefined
}

/** `<thumb aspect=…>` 与 `<fanart><thumb>`。 */
function artwork(meta: MediaMetadata): Array<XmlNode | undefined> {
  const fanart = imageOf(meta, 'backdrop')
  return [
    el('thumb', imageOf(meta, 'poster'), { aspect: 'poster' }),
    el('thumb', imageOf(meta, 'logo'), { aspect: 'clearlogo' }),
    fanart ? group('fanart', [el('thumb', fanart)]) : undefined,
  ]
}

/** 一位演员。 */
function actor(person: PersonCredit, index: number): XmlNode | undefined {
  return group('actor', [
    el('name', person.name),
    el('role', person.character),
    el('order', person.order ?? index),
    el(
      'thumb',
      person.profilePath
        ? TmdbProvider.imageUrl(person.profilePath, 'h632')
        : undefined
    ),
    el('profile', `https://www.themoviedb.org/person/${person.id}`),
    el('tmdbid', person.id),
  ])
}

/** 导演 / 编剧（去重保序）。 */
function crewNames(
  meta: MediaMetadata,
  pick: (job: string) => boolean
): string[] {
  return [
    ...new Set(meta.crew.filter(c => c.job && pick(c.job)).map(c => c.name)),
  ]
}

/** 电影与剧集共有的描述字段（标题、年份、简介……）。 */
function common(meta: MediaMetadata): Array<XmlNode | undefined> {
  return [
    el('title', meta.title),
    el('originaltitle', meta.originalTitle ?? meta.title),
    el('sorttitle', meta.title),
    ...ratings(meta.rating, meta.voteCount),
    el('year', meta.year),
    el('premiered', meta.releaseDate),
    el('plot', meta.overview),
    el('outline', meta.overview),
    el('tagline', meta.tagline),
    el('runtime', meta.runtimeMinutes),
    el('mpaa', meta.certification),
    ...meta.genres.map(g => el('genre', g)),
    ...meta.countries.map(c => el('country', countryName(c))),
    ...meta.companies.map(c => el('studio', c)),
  ]
}

/** movie.nfo / <视频名>.nfo。 */
export function buildMovieNfo(meta: MediaMetadata): XmlNode {
  return {
    tag: 'movie',
    children: [
      ...common(meta),
      ...crewNames(meta, j => j === 'Director').map(n => el('director', n)),
      ...crewNames(meta, j => WRITER_JOBS.has(j)).map(n => el('credits', n)),
      meta.collection
        ? group('set', [el('name', meta.collection.name)], {
            tmdbcolid: meta.collection.id,
          })
        : undefined,
      ...ids(meta),
      ...artwork(meta),
      ...meta.cast.map(actor),
    ].filter(isPresent),
  }
}

/** tvshow.nfo 用到的季概要。 */
export interface SeasonName {
  season: number
  name: string
}

/** tvshow.nfo。 */
export function buildTvShowNfo(
  meta: MediaMetadata,
  seasons: SeasonName[] = meta.seasons?.map(s => ({
    season: s.season,
    name: s.name,
  })) ?? []
): XmlNode {
  return {
    tag: 'tvshow',
    children: [
      ...common(meta),
      el('showtitle', meta.title),
      el('status', meta.status),
      ...crewNames(meta, j => j === 'Director').map(n => el('director', n)),
      ...crewNames(meta, j => WRITER_JOBS.has(j) || j === 'Creator').map(n =>
        el('credits', n)
      ),
      ...seasons.map(s => el('namedseason', s.name, { number: s.season })),
      el(
        'episodeguide',
        JSON.stringify({ tmdb: meta.externalIds.tmdb ?? meta.ref.id })
      ),
      ...ids(meta),
      ...artwork(meta),
      ...meta.cast.map(actor),
    ].filter(isPresent),
  }
}

/** season.nfo（Jellyfin / Emby）。 */
export function buildSeasonNfo(
  season: Omit<SeasonMetadata, 'episodes'>,
  series: MediaMetadata | null
): XmlNode {
  const year = season.airDate ? Number(season.airDate.slice(0, 4)) : undefined
  return {
    tag: 'season',
    children: [
      el('title', season.name),
      el('showtitle', series?.title),
      el('seasonnumber', season.season),
      el('year', year),
      el('premiered', season.airDate),
      el('releasedate', season.airDate),
      el('plot', season.overview),
      el('outline', season.overview),
      el(
        'thumb',
        season.posterPath
          ? TmdbProvider.imageUrl(season.posterPath)
          : undefined,
        { aspect: 'poster' }
      ),
    ].filter(isPresent),
  }
}

/** <集>.nfo 的一个 episodedetails（一个文件含多集时每集一个）。 */
export function buildEpisodeNfo(
  episode: EpisodeMetadata,
  series: MediaMetadata | null
): XmlNode {
  return {
    tag: 'episodedetails',
    children: [
      el('title', episode.title),
      el('showtitle', series?.title),
      el('season', episode.season),
      el('episode', episode.episode),
      ...ratings(episode.rating),
      el('plot', episode.overview),
      el('outline', episode.overview),
      el('runtime', episode.runtimeMinutes),
      el('aired', episode.airDate),
      el('premiered', episode.airDate),
      el(
        'thumb',
        episode.stillPath ? TmdbProvider.imageUrl(episode.stillPath) : undefined
      ),
      ...(series?.companies ?? []).map(c => el('studio', c)),
    ].filter(isPresent),
  }
}

/** 拼成完整文件（XML 声明 + 一个或多个根元素，结尾换行）。 */
export function renderNfo(roots: XmlNode[]): string {
  return `${XML_DECLARATION}\n${roots.map(r => renderNode(r)).join('\n')}\n`
}
