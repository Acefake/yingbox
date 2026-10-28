/**
 * 海报评分角标：豆瓣优先，没有豆瓣分数时用 TMDB。
 * 分数保留一位小数；「暂无」、0、空串都算没有分数。
 */

export type RatingMark = 'douban' | 'tmdb'

export interface RatingBadgeValue {
  source: RatingMark
  score: string
}

function scoreOf(value: unknown): string | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d/.test(value.trim())
        ? Number(value)
        : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return n.toFixed(1)
}

/** 挑角标上的来源和分数；两个都没有时返回 null（角标不渲染）。 */
export function pickRatingBadge(
  douban?: unknown,
  tmdb?: unknown
): RatingBadgeValue | null {
  const doubanScore = scoreOf(douban)
  if (doubanScore) return { source: 'douban', score: doubanScore }
  const tmdbScore = scoreOf(tmdb)
  if (tmdbScore) return { source: 'tmdb', score: tmdbScore }
  return null
}
