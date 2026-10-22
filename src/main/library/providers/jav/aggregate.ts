/**
 * 多站点结果聚合与入库形状转换。
 *
 * 聚合规则（参考 Amane aggregate 的思路，大幅简化）：站点按设置里的优先级排好，
 * 每个字段取第一个非空值；列表字段（类别、演员、剧照）也取第一个非空列表，不跨站合并，
 * 免得同一个演员 / 类别因写法不同出现两次。演员头像例外：首选站点没有头像时，
 * 用其他站点同名演员的头像补上。
 */
import type {
  ImageCandidate,
  MediaMetadata,
  PersonCredit,
} from '../../../../shared/library/provider'
import { posterFromCover } from '../../images/derived'
import type { JavActor, JavRecord, JavSiteId } from './types'

/** 聚合后的一部片。 */
export interface JavMovie extends Omit<JavRecord, 'site' | 'url'> {
  /** 每个字段实际取自哪个站点（调试 / 日志用）。 */
  sources: Partial<Record<keyof JavRecord, JavSiteId>>
}

const SCALAR_FIELDS = [
  'title',
  'releaseDate',
  'runtimeMinutes',
  'director',
  'studio',
  'label',
  'series',
  'overview',
  'cover',
  'poster',
] as const satisfies ReadonlyArray<keyof JavRecord>

const LIST_FIELDS = [
  'tags',
  'actors',
  'stills',
] as const satisfies ReadonlyArray<keyof JavRecord>

/** 首选站点的演员，缺头像的用其他站点同名演员补。 */
function withPhotos(actors: JavActor[], records: JavRecord[]): JavActor[] {
  const photos = new Map<string, string>()
  for (const r of records) {
    for (const a of r.actors)
      if (a.photo && !photos.has(a.name)) photos.set(a.name, a.photo)
  }
  return actors.map(a =>
    a.photo || !photos.has(a.name) ? a : { ...a, photo: photos.get(a.name) }
  )
}

/**
 * 按优先级聚合（records 已按站点优先级排序）；没有任何结果返回 null。
 * 番号先取首选站点页面上的写法，JavProvider 再统一换成文件名解析出的写法。
 */
export function aggregate(records: JavRecord[]): JavMovie | null {
  if (!records.length) return null
  const sources: JavMovie['sources'] = { code: records[0].site }
  const movie: JavMovie = {
    code: records[0].code,
    tags: [],
    actors: [],
    stills: [],
    sources,
  }
  for (const field of SCALAR_FIELDS) {
    const hit = records.find(r => r[field] !== undefined && r[field] !== '')
    if (hit) {
      ;(movie as unknown as Record<string, unknown>)[field] = hit[field]
      sources[field] = hit.site
    }
  }
  for (const field of LIST_FIELDS) {
    const hit = records.find(r => r[field].length > 0)
    if (hit) {
      ;(movie as unknown as Record<string, unknown>)[field] = hit[field]
      sources[field] = hit.site
    }
  }
  movie.actors = withPhotos(movie.actors, records)
  return movie
}

/** 一张远程图片（path 直接放绝对 URL，图片 URL 拼接时原样返回，见 TmdbProvider.imageUrl）。 */
function image(role: ImageCandidate['role'], url: string): ImageCandidate {
  return {
    role,
    path: url,
    language: null,
    width: 0,
    height: 0,
    voteAverage: 0,
    voteCount: 0,
  }
}

/**
 * 聚合结果 → 入库元数据。
 * 标题写成「番号 片名」，海报墙上一眼能看到番号，按标题排序也就是按番号排序；原名存站点标题。
 * 制作商、发行商进 companies（NFO 的 studio）；系列进 collection（NFO 的 set）；剧照记为 still。
 *
 * 海报（poster）：'native' 用站点自带的竖版海报，没有时拿封面顶上；
 * 'crop' 先用封面裁右侧的派生图（见 images/derived.ts），站点海报排第二作兜底。
 * 选哪种由 JavProvider 决定：有码片站点海报缺失或太小才裁。
 */
export function toMetadata(
  movie: JavMovie,
  poster: 'native' | 'crop' = 'native'
): MediaMetadata {
  const year = movie.releaseDate
    ? Number(movie.releaseDate.slice(0, 4))
    : undefined
  const cast: PersonCredit[] = movie.actors.map((a, order) => ({
    id: a.name,
    name: a.name,
    order,
    ...(a.photo ? { profilePath: a.photo } : {}),
  }))
  const crew: PersonCredit[] = movie.director
    ? [{ id: movie.director, name: movie.director, job: 'Director' }]
    : []
  const posters = [
    ...(poster === 'crop' && movie.cover ? [posterFromCover(movie.cover)] : []),
    ...(movie.poster ? [movie.poster] : []),
  ]
  // 没有竖版海报时用封面顶上，海报墙至少有图
  if (!posters.length && movie.cover) posters.push(movie.cover)
  const images = [
    ...posters.map(url => image('poster', url)),
    ...(movie.cover ? [image('backdrop', movie.cover)] : []),
    ...movie.stills.map(url => image('still', url)),
  ]
  return {
    ref: { provider: 'jav', kind: 'movie', id: movie.code },
    title: movie.title ? `${movie.code} ${movie.title}` : movie.code,
    ...(movie.title ? { originalTitle: movie.title } : {}),
    originalLanguage: 'ja',
    ...(year && Number.isFinite(year) ? { year } : {}),
    ...(movie.releaseDate ? { releaseDate: movie.releaseDate } : {}),
    ...(movie.overview ? { overview: movie.overview } : {}),
    genres: movie.tags,
    ...(movie.runtimeMinutes ? { runtimeMinutes: movie.runtimeMinutes } : {}),
    countries: [],
    companies: [
      ...new Set(
        [movie.studio, movie.label].filter((v): v is string => Boolean(v))
      ),
    ],
    cast,
    crew,
    images,
    externalIds: {},
    ...(movie.series
      ? { collection: { id: movie.series, name: movie.series } }
      : {}),
  }
}
