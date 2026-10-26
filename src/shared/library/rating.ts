/**
 * 评分来源与显示：片库 `media_items.rating_source`、NFO `<rating name>` 的来源映射，
 * 以及所有界面共用的评分文案（豆瓣 8.2 / TMDB 7.9 / 不知道来源时只有 8.2）。
 */

/** 评分来源；null 表示不知道（老数据、来源无从推断）。nfo = NFO 里没写来源名的评分。 */
export type RatingSource = 'douban' | 'tmdb' | 'imdb' | 'nfo'

/** 显示用的来源名；nfo 没有具体来源，不标。 */
const LABELS: Partial<Record<RatingSource, string>> = {
  douban: '豆瓣',
  tmdb: 'TMDB',
  imdb: 'IMDb',
}

/**
 * NFO `<rating name="…">` → 评分来源（Kodi 写 themoviedb / imdb，豆瓣刮削器写 douban）。
 * @example ratingSourceOf('themoviedb') // 'tmdb'
 */
export function ratingSourceOf(name: string | undefined): RatingSource {
  const key = name?.trim().toLowerCase() ?? ''
  if (key === 'douban') return 'douban'
  if (key === 'themoviedb' || key === 'tmdb') return 'tmdb'
  if (key === 'imdb') return 'imdb'
  return 'nfo'
}

/**
 * 评分文案：保留一位小数，知道来源时前面带来源名；没有评分返回空串。星标由调用处画。
 * @example formatRating(8.2, 'douban') // '豆瓣 8.2'
 * @example formatRating(8.2, null) // '8.2'
 */
export function formatRating(
  rating: number | null | undefined,
  source?: RatingSource | null
): string {
  if (!rating || !Number.isFinite(rating) || rating <= 0) return ''
  const label = source ? LABELS[source] : undefined
  return label ? `${label} ${rating.toFixed(1)}` : rating.toFixed(1)
}
