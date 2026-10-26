/**
 * 片库搜索结果 → 结果行（UiMediaRow 紧凑行）的显示数据（纯规则）。
 *
 * 卡片信息（详情树取来的类型、时长、4K / 全景声等）没到之前，先用结果自带的：评分、探测到的动态范围；
 * 到了就换成完整的。年份已跟在片名后面，说明里不再重复。
 */
import { type SpecBadge, videoRangeSpec } from '@/components/ui/spec-badge'

import type { LibraryCardInfo } from '../detail/card-info'
import { libraryPoster } from '../detail/assistant-links'
import { formatRating } from '../../../../../shared/library/rating'
import type { SearchHit } from './types'

export interface HitRow {
  image: string | null
  year: number | null
  /** 类型 · 时长或季数 */
  meta: string[]
  specs: SpecBadge[]
  rating: string
  /** 命中理由（「片名匹配」「AI 理解 · 科幻」）与版本数 */
  note: string[]
}

const YEAR_PART = /^\d{4} 年$/

/**
 * @param hit 搜索结果
 * @param info 卡片信息；还没取到为 undefined
 */
export function hitRow(hit: SearchHit, info?: LibraryCardInfo): HitRow {
  const range = videoRangeSpec(hit.item.videoRange)
  return {
    image: libraryPoster(hit.item.poster),
    year: hit.item.year,
    meta: info ? info.meta.filter(part => !YEAR_PART.test(part)) : [],
    specs: info ? info.specs : range ? [range] : [],
    rating: info
      ? info.rating
      : formatRating(hit.item.rating, hit.item.ratingSource),
    note: [
      ...hit.reasons,
      hit.versions.length > 1 ? `${hit.versions.length} 个版本` : '',
    ].filter(Boolean),
  }
}
