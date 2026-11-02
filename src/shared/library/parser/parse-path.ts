/**
 * 路径级解析：文件名 + 父文件夹上下文 → ParsedMedia。
 */
import { NUMBER_PATTERN, hasCjk, parseNumber } from './cjk'
import { memoize } from './memo'
import { type NameInfo, parseName } from './name'
import type { ExternalIds, ParsedMedia } from './types'
import {
  CATEGORY_FOLDER_RE,
  EXTRAS_FOLDER_RE,
  GENERIC_STEM_RE,
  MEDIA_EXTENSION_RE,
  STRUCTURAL_FOLDER_RE,
} from './vocabulary'

const SEASON_FOLDER_RES: RegExp[] = [
  /^(?:season|series|staffel|saison|temporada)[\s._-]*(\d{1,4})$/i,
  /^s(\d{1,2})$/i,
  new RegExp(`^第\\s*(${NUMBER_PATTERN})\\s*季$`),
]
const SPECIALS_FOLDER_RE = /^(?:specials?|sp|sps|特别篇|特別篇|番外篇?)$/i
const DISC_FOLDER_RE = /^(?:cd|dvd|disc|disk)[\s._-]*(\d{1,2})$/i

/** 沿路径向上找到的文件夹上下文。 */
interface FolderContext {
  /** 最近的承载片名的文件夹（电影文件夹 / 剧集文件夹）。 */
  owner?: NameInfo
  /** owner 在 folders 里的下标。 */
  ownerIndex?: number
  season?: number
  part?: number
  /** 文件位于附加内容文件夹（Featurettes、Sample、花絮…）里。 */
  inExtras: boolean
}

function seasonOfFolder(name: string): number | undefined {
  if (SPECIALS_FOLDER_RE.test(name)) return 0
  for (const re of SEASON_FOLDER_RES) {
    const m = re.exec(name)
    if (m) return parseNumber(m[1])
  }
  return undefined
}

/** 从近到远走父文件夹，跳过结构性文件夹，遇到第一个承载片名的文件夹停下。 */
function readFolders(folders: string[]): FolderContext {
  const ctx: FolderContext = { inExtras: false }
  for (let i = folders.length - 1; i >= 0; i--) {
    const name = folders[i].trim()
    if (STRUCTURAL_FOLDER_RE.test(name)) continue
    if (EXTRAS_FOLDER_RE.test(name)) {
      ctx.inExtras = true
      continue
    }
    const season = seasonOfFolder(name)
    if (season !== undefined) {
      ctx.season ??= season
      continue
    }
    const disc = DISC_FOLDER_RE.exec(name)
    if (disc) {
      ctx.part ??= Number(disc[1])
      continue
    }
    ctx.owner = parseFolderName(name)
    ctx.ownerIndex = i
    break
  }
  return ctx
}

/** 文件夹名解析结果按名字缓存：同一文件夹下的文件共享一次解析。 */
const parseFolderName = memoize((name: string) =>
  parseName(name, { folder: true })
)

const normTitle = (s: string | undefined): string =>
  (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** 文件名与文件夹名指的是不是同一个片名（任一主/副标题相同即可）。 */
function sameWork(a: NameInfo, b: NameInfo): boolean {
  const left = [a.title, a.altTitle].map(normTitle).filter(Boolean)
  const right = new Set([b.title, b.altTitle].map(normTitle).filter(Boolean))
  return left.some(t => right.has(t))
}

/** 分类文件夹（「大陆」「美剧」，见 CATEGORY_FOLDER_RE）里直接放着的是一集（文件名自带剧名和集号）。 */
function isCategoryFolder(folderName: string, file: NameInfo): boolean {
  const episode = file.episodes.length > 0 || file.airDate !== undefined
  return (
    episode && file.title !== '' && CATEGORY_FOLDER_RE.test(folderName.trim())
  )
}

/**
 * 文件夹是不是这部作品自己的文件夹：带年份 / 外部 id、像发布包，或名字就是给出的某个片名。
 * 电影整理用它分辨「电影/Buddy.mkv」里的「电影」是分类文件夹（ADR-0029）。
 */
export function isWorkFolder(folderName: string, titles: string[]): boolean {
  const folder = parseFolderName(folderName.trim())
  if (
    folder.year !== undefined ||
    Object.keys(folder.ids).length > 0 ||
    folder.releaseLike
  )
    return true
  const wanted = new Set(titles.map(normTitle).filter(Boolean))
  return [folder.title, folder.altTitle].some(t => {
    const name = normTitle(t)
    return name !== '' && wanted.has(name)
  })
}

/** 路径布局：作品文件夹与整理基准的深度（folders[0..n) 那一段）。 */
export interface FolderLayout {
  /** 作品文件夹（含上层分类文件夹）；没有作品文件夹时为 0 */
  owner: number
  /** 整理基准：作品文件夹的上层；集直接放在分类文件夹里时是分类文件夹本身 */
  base: number
}

/**
 * 文件所在路径的布局。跳过季（Season 1、S01、第一季、Specials）、碟片、附加内容和结构性文件夹，
 * 遇到的第一个承载片名的文件夹是作品文件夹；给了文件名、而它是剧集文件直接所在的分类文件夹时不算（ADR-0029）。
 * @param fileName 文件名（带扩展名）；不给时不做分类文件夹判定
 */
export function folderLayout(
  folders: string[],
  fileName?: string
): FolderLayout {
  const ctx = readFolders(folders)
  const index = ctx.ownerIndex
  if (index === undefined || !ctx.owner) return { owner: 0, base: 0 }
  const direct =
    index === folders.length - 1 &&
    ctx.season === undefined &&
    ctx.part === undefined &&
    !ctx.inExtras
  if (
    fileName !== undefined &&
    direct &&
    isCategoryFolder(
      folders[index],
      parseName(fileName.replace(MEDIA_EXTENSION_RE, ''))
    )
  )
    return { owner: 0, base: index + 1 }
  return { owner: index + 1, base: index }
}

/**
 * 作品文件夹在路径里的深度：folders[0..depth) 就是作品文件夹（含上层分类文件夹）；没有时为 0。
 * @param fileName 文件名；给了才认出分类文件夹（见 folderLayout）
 */
export function ownerFolderDepth(folders: string[], fileName?: string): number {
  return folderLayout(folders, fileName).owner
}

const nonEmptyIds = (ids: ExternalIds): ExternalIds | undefined =>
  Object.keys(ids).length ? ids : undefined

/**
 * 解析一个媒体文件路径（Windows 或 POSIX 分隔符均可）。
 *
 * 文件名给出的信息优先；文件名是通用名（movie.mkv、CD1、VIDEO_TS、00001.m2ts）或没有片名时
 * 回退到最近的承载片名的父文件夹；季号、分段和外部 ID 可以从父文件夹补齐。
 */
export function parseMediaPath(
  path: string,
  options?: { inferUnnumberedSeason?: boolean; forceMovie?: boolean }
): ParsedMedia {
  const segments = path.split(/[\\/]+/).filter(Boolean)
  const fileName = segments.pop() ?? ''
  const stem = fileName.replace(MEDIA_EXTENSION_RE, '')
  const file = parseName(stem, { folder: options?.forceMovie })
  const ctx = readFolders(segments)
  const owner = ctx.owner
  const ids = nonEmptyIds({ ...owner?.ids, ...file.ids })
  const generic = GENERIC_STEM_RE.test(stem.trim()) || !file.title
  // 文件名把片名里的数字读成了集号或年份（300.mkv、The Legend of 1900.mkv），以文件夹为准
  const ownerTitle = normTitle(owner?.title)
  const misread =
    ownerTitle !== '' &&
    ((file.bare && !file.title && normTitle(stem) === ownerTitle) ||
      (file.year !== undefined &&
        normTitle(`${file.title}${file.year}`) === ownerTitle))
  const isEpisode =
    !options?.forceMovie &&
    !misread &&
    (file.episodes.length > 0 ||
      file.airDate !== undefined ||
      (options?.inferUnnumberedSeason === true && ctx.season !== undefined))

  // 片名来源：文件名；通用名回退到文件夹；混淆过的文件名（没有年份）在发布包文件夹里也信文件夹
  let source: NameInfo = file
  if (
    owner &&
    (generic ||
      ctx.inExtras ||
      misread ||
      (options?.inferUnnumberedSeason === true &&
        ctx.season !== undefined &&
        file.episodes.length === 0 &&
        file.airDate === undefined))
  )
    source = owner
  else if (
    owner &&
    !isEpisode &&
    file.year === undefined &&
    owner.year !== undefined &&
    owner.releaseLike &&
    !sameWork(file, owner)
  ) {
    source = owner
  }
  let year = source.year
  if (year === undefined && source === file && owner && sameWork(file, owner)) {
    year = owner.year
  }

  const base = {
    title: source.title,
    ...(source.altTitle ? { altTitle: source.altTitle } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(ids ? { ids } : {}),
  }

  if (ctx.inExtras || file.extra) return { type: 'extra', ...base }

  if (isEpisode) {
    const season = file.season ?? ctx.season
    const absolute =
      file.bare &&
      season === undefined &&
      (file.hasGroup || !hasCjk(base.title))
    return {
      type: 'episode',
      ...base,
      ...(season !== undefined ? { season } : {}),
      episodes: file.episodes,
      ...(absolute ? { absolute: true } : {}),
      ...(file.airDate ? { airDate: file.airDate } : {}),
    }
  }

  const part = file.part ?? ctx.part
  return { type: 'movie', ...base, ...(part !== undefined ? { part } : {}) }
}
