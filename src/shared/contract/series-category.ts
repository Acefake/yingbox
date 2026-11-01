/**
 * 剧的分类：按 TMDB 的类型归成 剧集 / 动漫 / 综艺 / 纪录片。追更页按它筛选，每类可以各自指定转存文件夹。
 * 纯规则，片库服务（给日历里的剧打标）与界面共用。
 */

export const SERIES_CATEGORIES = [
  'tv',
  'anime',
  'variety',
  'documentary',
] as const
export type SeriesCategory = (typeof SERIES_CATEGORIES)[number]

export const SERIES_CATEGORY_LABEL: Record<SeriesCategory, string> = {
  tv: '剧集',
  anime: '动漫',
  variety: '综艺',
  documentary: '纪录片',
}

/** TMDB 电视类型 id：动画 / 纪录片 / 真人秀 / 脱口秀 */
const ANIMATION = 16
const DOCUMENTARY = 99
const REALITY = 10764
const TALK = 10767

/** TMDB 类型 id → 分类：纪录片、综艺（真人秀、脱口秀）、动漫（动画）优先，其余是剧集 */
export function categoryOfGenres(genreIds: readonly number[]): SeriesCategory {
  if (genreIds.includes(DOCUMENTARY)) return 'documentary'
  if (genreIds.includes(REALITY) || genreIds.includes(TALK)) return 'variety'
  if (genreIds.includes(ANIMATION)) return 'anime'
  return 'tv'
}

/** 认得出的分类；否则 undefined */
export function categoryOf(raw: unknown): SeriesCategory | undefined {
  return SERIES_CATEGORIES.includes(raw as SeriesCategory)
    ? (raw as SeriesCategory)
    : undefined
}
