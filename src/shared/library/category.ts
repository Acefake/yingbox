/**
 * 内容类别：按 TMDB 类型把电影 / 剧集分到互斥的几类，片库侧栏据此分页，追更页的剧分类（series-category）同一口径。
 *
 * 优先级：纪录片 > 综艺（真人秀、脱口秀）> 动漫（动画）> 普通。先看类型 id（与元数据语言无关，
 * 刮削时存进 metadata.genreIds）；更早刮削、没有 id 的条目再按类型名（简中 / 英文）兜底。
 * 没命中、没有类型的都算普通。纯数据 + 纯函数，主进程 SQL 与界面共用。
 */

/** 内容类别；plain = 不属于前三类的电影与剧集。 */
export type MediaCategory = 'documentary' | 'variety' | 'anime' | 'plain'

/** 全部类别（校验用）。 */
export const CATEGORIES: readonly MediaCategory[] = [
  'documentary',
  'variety',
  'anime',
  'plain',
]

/** 按优先级排列的非普通类别。 */
export const SPECIAL_CATEGORIES = ['documentary', 'variety', 'anime'] as const

type SpecialCategory = (typeof SPECIAL_CATEGORIES)[number]

/** 各类别的 TMDB 类型 id：纪录片 99，真人秀 10764、脱口秀 10767，动画 16。 */
export const CATEGORY_GENRE_IDS: Readonly<
  Record<SpecialCategory, readonly number[]>
> = {
  documentary: [99],
  variety: [10764, 10767],
  anime: [16],
}

/** 各类别认的类型名（没有 genreIds 的旧条目兜底用；TMDB 简中与英文）。 */
export const CATEGORY_GENRES: Readonly<
  Record<SpecialCategory, readonly string[]>
> = {
  documentary: ['纪录', '纪录片', 'Documentary'],
  variety: ['真人秀', '脱口秀', 'Reality', 'Talk'],
  anime: ['动画', 'Animation'],
}

/**
 * 一个条目的类别（取优先级最高的命中项）。
 * @param genres 类型名
 * @param genreIds TMDB 类型 id（有就优先看）
 */
export function categoryOf(
  genres: readonly string[],
  genreIds: readonly number[] = []
): MediaCategory {
  for (const category of SPECIAL_CATEGORIES)
    if (
      genreIds.some(id => CATEGORY_GENRE_IDS[category].includes(id)) ||
      genres.some(g => CATEGORY_GENRES[category].includes(g))
    )
      return category
  return 'plain'
}
