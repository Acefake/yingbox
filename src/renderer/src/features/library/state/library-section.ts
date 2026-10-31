/**
 * 片库分区：界面上的「电影」「电视剧」「番号」三个页面各管一部分媒体库。
 *
 * 后端只有两种库类型（movie / tv）和两种来源（tmdb / jav）；番号库是 kind=movie、source=jav 的库。
 * 分区把这两个维度合成一个：电影 = movie + tmdb，电视剧 = tv + tmdb，番号 = movie + jav。
 * 每个页面的媒体库列表、海报墙、待确认、统计都只看自己分区的库，番号条目不会出现在电影页。
 *
 * 纯数据 + 纯函数，不依赖 Vue，便于单测。
 */
import type {
  LibraryInfo,
  LibraryKind,
  LibrarySource,
  MediaItemType,
} from '../../../../../shared/library/ipc'

/** 片库分区。 */
export type LibrarySection = 'movie' | 'tv' | 'jav'

/** 一个分区的固定属性。 */
export interface SectionSpec {
  /** 后端库类型。 */
  kind: LibraryKind
  /** 后端库来源。 */
  source: LibrarySource
  /** 页面标题、按钮文案里的名字。 */
  label: string
  /** 空状态与连接页的图标。 */
  icon: 'movie' | 'tv' | 'tag'
  /** 页面路由。 */
  path: string
}

/** 三个分区。 */
export const SECTIONS: Readonly<Record<LibrarySection, SectionSpec>> = {
  movie: {
    kind: 'movie',
    source: 'tmdb',
    label: '电影',
    icon: 'movie',
    path: '/movie',
  },
  tv: { kind: 'tv', source: 'tmdb', label: '剧集', icon: 'tv', path: '/tv' },
  jav: {
    kind: 'movie',
    source: 'jav',
    label: '番号',
    icon: 'tag',
    path: '/jav',
  },
}

/** 一个媒体库属于哪个分区（旧数据没有 source 时按 tmdb 算）。 */
export function sectionOf(
  lib: Pick<LibraryInfo, 'kind' | 'mixed'> & { source?: LibrarySource },
  itemType?: MediaItemType
): LibrarySection {
  if (lib.source === 'jav') return 'jav'
  if (lib.mixed && itemType) return itemType === 'movie' ? 'movie' : 'tv'
  return lib.kind === 'tv' ? 'tv' : 'movie'
}

/** 只留属于该分区的媒体库。 */
export function librariesIn<
  T extends Pick<LibraryInfo, 'kind' | 'mixed'> & { source?: LibrarySource },
>(libraries: readonly T[], section: LibrarySection): T[] {
  return libraries.filter(
    lib =>
      (lib.mixed && lib.source !== 'jav' && section !== 'jav') ||
      sectionOf(lib) === section
  )
}
