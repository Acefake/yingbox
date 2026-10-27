/**
 * 一个顶层条目要写出哪些 sidecar：路径、NFO 内容或图片来源。纯函数，不碰文件系统与数据库。
 *
 * 命名规则（Kodi / Jellyfin / Emby 共同支持的写法，默认每类只写一份）：
 *
 * 电影——独占文件夹（文件夹里没有别的电影，且不是媒体库根目录）：
 *   <视频名>.nfo（同一部电影多个文件时 movie.nfo）、poster.jpg、fanart.jpg、clearlogo.png、.actors/
 *   旧命名：folder.jpg
 * 电影——与其他电影共用文件夹：每个视频各写
 *   <视频名>.nfo、<视频名>-poster.jpg、<视频名>-fanart.jpg、<视频名>-clearlogo.png
 *   旧命名：<视频名>-movie.jpg、<视频名>-folder.jpg（旧版刮削的写法）
 *
 * 剧集——剧集文件夹（媒体库根下第一层）：tvshow.nfo、poster.jpg、fanart.jpg、clearlogo.png、
 *   season01-poster.jpg（第 0 季 season-specials-poster.jpg）、.actors/；旧命名：folder.jpg
 * 季文件夹（与剧集文件夹不同时）：season.nfo；旧命名：poster.jpg
 * 每集：<视频名>.nfo（一个文件含多集时多个 episodedetails）、<视频名>-thumb.jpg
 * 剧集文件直接放在媒体库根目录时不写剧集级文件（不能把 tvshow.nfo 写进根目录）。
 */
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import type {
  ItemMetadata,
  LibraryItemNode,
  WriterSettings,
} from '../../../../shared/library/ipc'
import type {
  EpisodeMetadata,
  MediaMetadata,
} from '../../../../shared/library/provider'
import {
  DEFAULT_SCRAPE_PREFS,
  type TmdbImageSizes,
  tmdbImageSizes,
} from '../../../../shared/library/scrape-prefs'
import { safeSegment } from '../../../../shared/library/writer'
import { TmdbProvider } from '../../providers/tmdb/tmdb-provider'
import {
  buildEpisodeNfo,
  buildMovieNfo,
  buildSeasonNfo,
  buildTvShowNfo,
} from '../nfo/nfo-builder'
import type { XmlNode } from '../nfo/xml'
import type { NfoActorLookup } from '../../actors/actor-store'

/** 一个要写的 sidecar。 */
export type PlannedOutput =
  | { kind: 'nfo'; itemId: number; path: string; roots: XmlNode[] }
  | { kind: 'image'; itemId: number; path: string; url: string }

/** 计划上下文。 */
export interface PlanContext {
  /** 媒体库根目录（系统路径）。 */
  libraryRoot: string
  settings: WriterSettings
  /** 某目录里是否有别的条目的视频（电影是否独占文件夹）。 */
  sharedDir: (dir: string) => boolean
  /** 番号库条目演员的资料（演员库）：头像优先用它，NFO 写扩展字段。 */
  actors?: NfoActorLookup
  /** 写出图片的 TMDB 尺寸（刮削偏好）；缺省高清。 */
  imageSizes?: TmdbImageSizes
}

/** 一次写出用的 TMDB 图片尺寸。 */
type Sizes = TmdbImageSizes & { logo: string; still: string }

/**
 * 图片尺寸：海报 / 背景图 / 演员头像按刮削偏好（设置 · 刮削 · 图片质量）；缺省高清，
 * 与识别时缓存的尺寸一致，直接复用已下载的原图。标志、集缩略图总是原图。
 */
function sizesOf(ctx: PlanContext): Sizes {
  const base = ctx.imageSizes ?? tmdbImageSizes(DEFAULT_SCRAPE_PREFS.imageSize)
  return { ...base, logo: 'original', still: 'original' }
}

type TitleMeta = Extract<ItemMetadata, { level: 'title' }>

const titleMeta = (node: LibraryItemNode): TitleMeta | null =>
  node.metadata?.level === 'title' ? node.metadata : null

const stem = (file: string): string => basename(file, extname(file))

/** 首选图片地址；标志只要 png（TMDB 的 svg 标志播放器读不了）。 */
function imageUrl(
  meta: MediaMetadata,
  role: 'poster' | 'backdrop' | 'logo',
  sizes: Sizes
): string | undefined {
  const image = meta.images.find(
    i => i.role === role && (role !== 'logo' || /\.png$/i.test(i.path))
  )
  return image ? TmdbProvider.imageUrl(image.path, sizes[role]) : undefined
}

/** 演员头像文件名：Kodi 约定空格换成下划线。 */
function actorFile(name: string): string {
  return safeSegment(name.replace(/\s+/g, '_'), 'jpg')
}

/** 收集器：按设置过滤并去重（同一路径只写一次）。 */
class Outputs {
  readonly list: PlannedOutput[] = []
  private readonly seen = new Set<string>()

  constructor(
    private readonly itemId: number,
    readonly sizes: Sizes
  ) {}

  nfo(path: string, roots: XmlNode[]): void {
    if (this.seen.has(path)) return
    this.seen.add(path)
    this.list.push({ kind: 'nfo', itemId: this.itemId, path, roots })
  }

  image(paths: Array<string | false>, url: string | undefined): void {
    if (!url) return
    for (const path of paths) {
      if (!path || this.seen.has(path)) continue
      this.seen.add(path)
      this.list.push({ kind: 'image', itemId: this.itemId, path, url })
    }
  }

  actors(dir: string, meta: MediaMetadata, profiles?: NfoActorLookup): void {
    for (const person of meta.cast) {
      const thumb = profiles?.get(person.name)?.thumb ?? person.profilePath
      if (!thumb) continue
      const file = actorFile(person.name)
      if (file) {
        this.image(
          [join(dir, '.actors', file)],
          TmdbProvider.imageUrl(thumb, this.sizes.profile)
        )
      }
    }
  }
}

/** 电影。 */
function planMovie(node: LibraryItemNode, ctx: PlanContext): PlannedOutput[] {
  const meta = titleMeta(node)
  if (!meta) return []
  const { nfo, artwork } = ctx.settings
  const legacy = artwork.legacyNames
  const out = new Outputs(node.id, sizesOf(ctx))
  const byDir = new Map<string, string[]>()
  for (const f of node.files) {
    if (f.kind !== 'video') continue
    const dir = dirname(f.path)
    byDir.set(dir, [...(byDir.get(dir) ?? []), f.path])
  }
  const poster = imageUrl(meta, 'poster', out.sizes)
  const fanart = imageUrl(meta, 'backdrop', out.sizes)
  const logo = imageUrl(meta, 'logo', out.sizes)
  for (const [dir, videos] of byDir) {
    const own = dir !== ctx.libraryRoot && !ctx.sharedDir(dir)
    if (nfo.enabled) {
      if (own && videos.length > 1)
        out.nfo(join(dir, 'movie.nfo'), [buildMovieNfo(meta, ctx.actors)])
      else
        for (const v of videos)
          out.nfo(join(dir, `${stem(v)}.nfo`), [
            buildMovieNfo(meta, ctx.actors),
          ])
    }
    const names = own ? [''] : videos.map(v => `${stem(v)}-`)
    for (const prefix of names) {
      if (artwork.poster) {
        out.image(
          own
            ? ['poster.jpg', legacy && 'folder.jpg'].map(n => n && join(dir, n))
            : [
                `${prefix}poster.jpg`,
                legacy && `${prefix}movie.jpg`,
                legacy && `${prefix}folder.jpg`,
              ].map(n => n && join(dir, n)),
          poster
        )
      }
      if (artwork.fanart) out.image([join(dir, `${prefix}fanart.jpg`)], fanart)
      if (artwork.logo) out.image([join(dir, `${prefix}clearlogo.png`)], logo)
    }
    if (artwork.actors) out.actors(dir, meta, ctx.actors)
  }
  return out.list
}

/** 一组路径的公共目录；不一致返回 null。 */
function commonDir(paths: string[]): string | null {
  const dirs = new Set(paths.map(p => dirname(p)))
  return dirs.size === 1 ? [...dirs][0] : null
}

/** 季海报文件名。 */
const seasonPosterName = (season: number): string =>
  season === 0
    ? 'season-specials-poster.jpg'
    : `season${String(season).padStart(2, '0')}-poster.jpg`

/** 剧集。 */
function planSeries(node: LibraryItemNode, ctx: PlanContext): PlannedOutput[] {
  const meta = titleMeta(node)
  if (!meta) return []
  const { nfo, artwork } = ctx.settings
  const out = new Outputs(node.id, sizesOf(ctx))
  const seasons = node.children.filter(c => c.type === 'season')
  const episodes = [
    ...node.children.filter(c => c.type === 'episode'),
    ...seasons.flatMap(s => s.children),
  ]
  const videoPaths = episodes.flatMap(e =>
    e.files.filter(f => f.kind === 'video').map(f => f.path)
  )
  const firstLevel = new Set(
    videoPaths.map(p => relative(ctx.libraryRoot, p).split(sep)[0])
  )
  const seriesDir =
    firstLevel.size === 1 &&
    videoPaths.every(p => dirname(p) !== ctx.libraryRoot)
      ? join(ctx.libraryRoot, [...firstLevel][0])
      : null

  if (seriesDir) {
    if (nfo.enabled)
      out.nfo(join(seriesDir, 'tvshow.nfo'), [buildTvShowNfo(meta)])
    if (artwork.poster) {
      out.image(
        [
          join(seriesDir, 'poster.jpg'),
          artwork.legacyNames && join(seriesDir, 'folder.jpg'),
        ],
        imageUrl(meta, 'poster', out.sizes)
      )
    }
    if (artwork.fanart)
      out.image(
        [join(seriesDir, 'fanart.jpg')],
        imageUrl(meta, 'backdrop', out.sizes)
      )
    if (artwork.logo)
      out.image(
        [join(seriesDir, 'clearlogo.png')],
        imageUrl(meta, 'logo', out.sizes)
      )
    if (artwork.actors) out.actors(seriesDir, meta)
  }

  for (const season of seasons) {
    const sm = season.metadata?.level === 'season' ? season.metadata : null
    if (!sm) continue
    const posterUrl = sm.posterPath
      ? TmdbProvider.imageUrl(sm.posterPath, out.sizes.poster)
      : undefined
    if (seriesDir && artwork.seasonArt) {
      out.image([join(seriesDir, seasonPosterName(sm.season))], posterUrl)
    }
    const seasonDir = commonDir(
      season.children.flatMap(e =>
        e.files.filter(f => f.kind === 'video').map(f => f.path)
      )
    )
    if (!seasonDir || !seriesDir || seasonDir === seriesDir) continue
    if (nfo.enabled)
      out.nfo(join(seasonDir, 'season.nfo'), [buildSeasonNfo(sm, meta)])
    if (artwork.seasonArt && artwork.legacyNames) {
      out.image([join(seasonDir, 'poster.jpg')], posterUrl)
    }
  }

  // 一个文件可能含多集（S01E01E02）：按文件汇总
  const byFile = new Map<string, EpisodeMetadata[]>()
  for (const ep of episodes) {
    const em = ep.metadata?.level === 'episode' ? ep.metadata : null
    if (!em) continue
    for (const f of ep.files) {
      if (f.kind === 'video')
        byFile.set(f.path, [...(byFile.get(f.path) ?? []), em])
    }
  }
  for (const [file, eps] of byFile) {
    eps.sort((a, b) => a.season - b.season || a.episode - b.episode)
    const base = join(dirname(file), stem(file))
    if (nfo.enabled)
      out.nfo(
        `${base}.nfo`,
        eps.map(e => buildEpisodeNfo(e, meta))
      )
    const still = eps.find(e => e.stillPath)?.stillPath
    if (artwork.seasonArt && still) {
      out.image(
        [`${base}-thumb.jpg`],
        TmdbProvider.imageUrl(still, out.sizes.still)
      )
    }
  }
  return out.list
}

/** 计划一个顶层条目的全部输出；未识别（没有元数据）的条目返回空。 */
export function planOutputs(
  node: LibraryItemNode,
  ctx: PlanContext
): PlannedOutput[] {
  if (node.type === 'movie') return planMovie(node, ctx)
  if (node.type === 'series') return planSeries(node, ctx)
  return []
}
