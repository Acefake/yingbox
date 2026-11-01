/**
 * 片库分区：侧栏「本地媒体」下的每个页面（电影 / 剧集 / 动漫 / 综艺 / 纪录片 / 番号）各管一部分条目。
 *
 * 普通片库（TMDB 来源）的文件夹不再分电影库、剧集库：新加的文件夹一律自动识别电影或剧集，
 * 页面按条目的顶层类型与内容类别（shared/library/category.ts，按 TMDB 类型互斥归类）切分，
 * 所以所有普通片库都出现在这五个页面的设置里。番号库是 source=jav 的库，只在番号页。
 *
 * 纯数据 + 纯函数，不依赖 Vue，便于单测。
 */
import type {
  ItemMetadata,
  LibraryInfo,
  LibrarySource,
  MediaItemType,
  TopLevelItemType,
} from '../../../../../shared/library/ipc'
import {
  type MediaCategory,
  categoryOf,
} from '../../../../../shared/library/category'
import type { SeriesCategory } from '../../../../../shared/contract/series-category'

/** 片库分区。 */
export type LibrarySection =
  | 'movie'
  | 'tv'
  | 'anime'
  | 'variety'
  | 'documentary'
  | 'jav'

/** 「继续播放」等记录用的粗分区：只分电影、剧集、番号。 */
export type BaseSection = 'movie' | 'tv' | 'jav'

/** 分区图标。 */
export type SectionIcon = 'movie' | 'tv' | 'sparkle' | 'mic' | 'globe' | 'tag'

/** 一个分区的固定属性。 */
export interface SectionSpec {
  /** 海报墙里的顶层条目类型。 */
  types: readonly TopLevelItemType[]
  /** 内容类别。 */
  category: MediaCategory
  /** 后端库来源。 */
  source: LibrarySource
  /** 页面标题、按钮文案里的名字。 */
  label: string
  /** 侧栏、空状态与连接页的图标。 */
  icon: SectionIcon
  /** 页面路由。 */
  path: string
  /** 路由名（侧栏判断当前页）。 */
  routeName: string
}

/** 全部分区（顺序即侧栏顺序）。 */
export const SECTIONS: Readonly<Record<LibrarySection, SectionSpec>> = {
  movie: {
    types: ['movie'],
    category: 'plain',
    source: 'tmdb',
    label: '电影',
    icon: 'movie',
    path: '/movie',
    routeName: 'Movie',
  },
  tv: {
    types: ['series'],
    category: 'plain',
    source: 'tmdb',
    label: '剧集',
    icon: 'tv',
    path: '/tv',
    routeName: 'TV',
  },
  anime: {
    types: ['movie', 'series'],
    category: 'anime',
    source: 'tmdb',
    label: '动漫',
    icon: 'sparkle',
    path: '/anime',
    routeName: 'Anime',
  },
  variety: {
    types: ['movie', 'series'],
    category: 'variety',
    source: 'tmdb',
    label: '综艺',
    icon: 'mic',
    path: '/variety',
    routeName: 'Variety',
  },
  documentary: {
    types: ['movie', 'series'],
    category: 'documentary',
    source: 'tmdb',
    label: '纪录片',
    icon: 'globe',
    path: '/documentary',
    routeName: 'Documentary',
  },
  jav: {
    types: ['movie'],
    category: 'plain',
    source: 'jav',
    label: '番号',
    icon: 'tag',
    path: '/jav',
    routeName: 'Jav',
  },
}

/**
 * 一部剧的详情在哪个页面：按剧的分类（追更 / 日历给的 SeriesCategory，与内容类别同一口径）
 * 直接去剧集 / 动漫 / 综艺 / 纪录片页，不用先到剧集页再由分区守卫换页。
 */
export function seriesPagePath(category?: SeriesCategory): string {
  return SECTIONS[category ?? 'tv'].path
}

/**
 * 页面对应的粗分区（继续播放、想看两排按它筛）；动漫等按类型分的页面没有，返回 null：
 * 这些记录只知道电影 / 剧集，不知道条目类型。
 */
export function baseSectionOf(section: LibrarySection): BaseSection | null {
  return section === 'movie' || section === 'tv' || section === 'jav'
    ? section
    : null
}

/** 页面要看的「继续播放」记录分区：动漫等页面电影和剧集都算（记录只分电影 / 剧集 / 番号）。 */
export function recordSectionsOf(section: LibrarySection): BaseSection[] {
  const base = baseSectionOf(section)
  return base ? [base] : ['movie', 'tv']
}

type LibraryLike = Pick<LibraryInfo, 'kind' | 'mixed'> & {
  source?: LibrarySource
}

/** 条目的粗分区（旧数据没有 source 时按 tmdb 算）：番号库归番号，其余按条目类型分电影 / 剧集。 */
export function sectionOf(
  lib: LibraryLike,
  itemType?: MediaItemType
): BaseSection {
  if (lib.source === 'jav') return 'jav'
  if (itemType) return itemType === 'movie' ? 'movie' : 'tv'
  return lib.kind === 'tv' ? 'tv' : 'movie'
}

/** 条目所在的页面：番号库归番号；普通片库先看内容类别，普通类再按类型分电影 / 剧集。 */
export function pageOf(
  lib: LibraryLike,
  item: {
    type: MediaItemType
    genres: readonly string[]
    metadata?: ItemMetadata | null
  }
): LibrarySection {
  if (lib.source === 'jav') return 'jav'
  const genreIds =
    item.metadata?.level === 'title' ? item.metadata.genreIds : undefined
  const category = categoryOf(item.genres, genreIds)
  if (category !== 'plain') return category
  return item.type === 'movie' ? 'movie' : 'tv'
}

/**
 * 在某分区添加文件夹时新库的类型：番号页加番号库；其他页面一律加混合库，按文件自动分电影 / 剧集
 * （混合库不看 kind，填 movie 占位）。
 */
export function newLibraryShape(
  section: LibrarySection
): Pick<LibraryInfo, 'kind' | 'source' | 'mixed'> {
  const { source } = SECTIONS[section]
  return { kind: 'movie', source, mixed: source !== 'jav' }
}

/** 只留属于该分区的媒体库：番号页只要番号库，其他页面是全部普通片库。 */
export function librariesIn<T extends LibraryLike>(
  libraries: readonly T[],
  section: LibrarySection
): T[] {
  const jav = section === 'jav'
  return libraries.filter(lib => (lib.source === 'jav') === jav)
}
