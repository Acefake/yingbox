/**
 * TMDB 图片 → 图片候选与排序。纯函数。
 */
import type {
  ImageCandidate,
  ImageRole,
} from '../../../../shared/library/provider'
import type { TmdbImage } from './tmdb-types'

/**
 * 图片排序：语言偏好（海报 / 标志：界面语言 > 英文 > 无文字 > 其他；背景图：无文字优先）
 * → 评分 → 票数 → 宽度。
 */
export function sortImages(
  images: ImageCandidate[],
  language: string
): ImageCandidate[] {
  const primary = language.split('-')[0]
  const rank = (img: ImageCandidate): number => {
    const order =
      img.role === 'backdrop' || img.role === 'still'
        ? [null, primary, 'en']
        : [primary, 'en', null]
    const i = order.indexOf(img.language)
    return i < 0 ? order.length : i
  }
  return [...images].sort(
    (a, b) =>
      a.role.localeCompare(b.role) ||
      rank(a) - rank(b) ||
      b.voteAverage - a.voteAverage ||
      b.voteCount - a.voteCount ||
      b.width - a.width
  )
}

/** TMDB 图片列表 → 图片候选；列表为空时用详情自带的主图兜底。 */
export function toImages(
  role: ImageRole,
  list: TmdbImage[] | undefined,
  fallback?: string | null
): ImageCandidate[] {
  // images 没取到（或被语言过滤为空）时，用详情自带的主海报 / 主背景图兜底
  const source = list?.length
    ? list
    : fallback
      ? [{ file_path: fallback, iso_639_1: null }]
      : []
  return source.map(i => ({
    role,
    path: i.file_path,
    language: i.iso_639_1 ?? null,
    width: i.width ?? 0,
    height: i.height ?? 0,
    voteAverage: i.vote_average ?? 0,
    voteCount: i.vote_count ?? 0,
  }))
}
