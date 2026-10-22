/**
 * 本地分组：识别之前，先按解析结果把文件归到本地条目（电影 / 剧集 → 季 → 集）。
 *
 * 每个条目有一个确定的 local_key，同一部作品的不同文件、不同次扫描都会落到同一个条目上；
 * P3 识别只给条目补 provider id 和元数据，不改变这里的结构。
 *
 * 规则：
 * - 电影库：除附加内容外一律是电影，按（归一化片名, 年份）分组，同片多版本归一条；
 * - 剧集库：剧集按“作品文件夹”分组（文件名里的剧名写法常常不统一）——从文件往上跳过
 *   季 / 碟片 / 附加内容文件夹后的第一层，键里带上它之前的整段路径，所以
 *   “韩剧/鬼谜东宫/Season 1/…”与“韩剧/努力克服自卑的我们/Season 1/…”是两部剧，
 *   不会因为同在分类文件夹“韩剧”下被并成一部；没有作品文件夹的按归一化剧名分组；季按季号，集按（季号, 集号）；绝对集数挂在剧集下、无季；
 *   按日期编号的节目以播出日期作集键；没有集号的文件各自成一集；
 * - 附加内容（预告、花絮、样片）不建条目。
 */
import type { LibraryKind, MediaItemType } from '../../../shared/library/ipc'
import type { ParsedMedia } from '../../../shared/library/parser'
import { normalizeTitle } from '../../../shared/library/scoring'
import { ownerFolderDepth } from '../../../shared/library/parser'
import { memoize } from '../../../shared/library/parser/memo'

/** 待写入的条目种子。 */
export interface ItemSeed {
  localKey: string
  type: MediaItemType
  title: string
  originalTitle: string | null
  year: number | null
  seasonNumber: number | null
  episodeNumber: number | null
  /** 父条目的 localKey；顶层为 null。 */
  parentKey: string | null
  /** 排序键（归一化片名）。 */
  sortTitle: string
  /** FTS 检索文本（片名 + 副标题归一化）。 */
  searchText: string
}

/** 一个文件的分组结果：ancestors 按父到子排列，文件关联到 leaves。 */
export interface FileGrouping {
  ancestors: ItemSeed[]
  leaves: ItemSeed[]
}

/** 分组上下文。 */
export interface GroupingContext {
  libraryId: number
  kind: LibraryKind
  /** 文件相对媒体库根目录的路径键（正斜杠）。 */
  relativeKey: string
}

/** 归一化有缓存：同一部剧的几十集反复出现同一个剧名。 */
const normalize = memoize(normalizeTitle, 8192)

const EMPTY: FileGrouping = { ancestors: [], leaves: [] }

function seed(
  partial: Omit<ItemSeed, 'sortTitle' | 'searchText'>,
  altTitle?: string
): ItemSeed {
  const sortTitle = normalize(partial.title)
  const alt = altTitle ? normalize(altTitle) : ''
  return {
    ...partial,
    sortTitle,
    searchText: alt && alt !== sortTitle ? `${sortTitle} ${alt}` : sortTitle,
  }
}

/** 电影条目。 */
function movieGrouping(
  ctx: GroupingContext,
  parsed: ParsedMedia
): FileGrouping {
  const norm = normalize(parsed.title) || normalize(parsed.altTitle ?? '')
  const year = parsed.year ?? null
  const movie = seed(
    {
      localKey: `movie:${ctx.libraryId}:${norm}:${year ?? ''}`,
      type: 'movie',
      title: parsed.title || parsed.altTitle || '',
      originalTitle: parsed.altTitle ?? null,
      year,
      seasonNumber: null,
      episodeNumber: null,
      parentKey: null,
    },
    parsed.altTitle
  )
  return { ancestors: [], leaves: [movie] }
}

/** 剧集条目键：优先用作品文件夹（连同上层分类文件夹的完整相对路径）。 */
function seriesKey(ctx: GroupingContext, title: string): string {
  const folders = ctx.relativeKey.split('/').slice(0, -1)
  const depth = ownerFolderDepth(folders)
  return depth > 0
    ? `series:${ctx.libraryId}:d:${folders.slice(0, depth).join('/')}`
    : `series:${ctx.libraryId}:t:${normalize(title)}`
}

/** 剧集 → 季 → 集。 */
function episodeGrouping(
  ctx: GroupingContext,
  parsed: ParsedMedia
): FileGrouping {
  const title = parsed.title || parsed.altTitle || ''
  const sKey = seriesKey(ctx, title)
  const series = seed(
    {
      localKey: sKey,
      type: 'series',
      title,
      originalTitle: parsed.altTitle ?? null,
      year: parsed.year ?? null,
      seasonNumber: null,
      episodeNumber: null,
      parentKey: null,
    },
    parsed.altTitle
  )
  const episode = (
    key: string,
    parentKey: string,
    seasonNumber: number | null,
    episodeNumber: number | null
  ): ItemSeed =>
    seed({
      localKey: `episode:${key}`,
      type: 'episode',
      title: '',
      originalTitle: null,
      year: null,
      seasonNumber,
      episodeNumber,
      parentKey,
    })

  if (parsed.type !== 'episode') {
    // 剧集库里没有集号的文件：各自成一集
    return {
      ancestors: [series],
      leaves: [episode(`${sKey}:f:${ctx.relativeKey}`, sKey, null, null)],
    }
  }
  if (parsed.airDate) {
    return {
      ancestors: [series],
      leaves: [episode(`${sKey}:d:${parsed.airDate}`, sKey, null, null)],
    }
  }
  if (parsed.season === undefined) {
    return {
      ancestors: [series],
      leaves: parsed.episodes.map(n =>
        episode(`${sKey}:a:${n}`, sKey, null, n)
      ),
    }
  }
  const seasonKey = `season:${sKey}:${parsed.season}`
  const season = seed({
    localKey: seasonKey,
    type: 'season',
    title: '',
    originalTitle: null,
    year: null,
    seasonNumber: parsed.season,
    episodeNumber: null,
    parentKey: sKey,
  })
  return {
    ancestors: [series, season],
    leaves: parsed.episodes.map(n =>
      episode(`${sKey}:${parsed.season}:${n}`, seasonKey, parsed.season!, n)
    ),
  }
}

/** 计算一个视频文件应归属的条目。 */
export function groupFile(
  ctx: GroupingContext,
  parsed: ParsedMedia
): FileGrouping {
  if (parsed.type === 'extra') return EMPTY
  if (!parsed.title && !parsed.altTitle) return EMPTY
  return ctx.kind === 'movie'
    ? movieGrouping(ctx, parsed)
    : episodeGrouping(ctx, parsed)
}
