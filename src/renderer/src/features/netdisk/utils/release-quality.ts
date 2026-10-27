/**
 * 网盘结果的画质规则（纯函数）：结果行左侧的画质角标、Hero 上的「最佳版本」和结果区的排序。
 * 认画质用全应用唯一的一份 shared/release/quality.ts（这里转出它的识别函数与类型）。
 */
import {
  type ReleaseQuality,
  parseReleaseQuality,
  sizeFromTitle,
} from '../../../../../shared/release/quality'

export {
  type ReleaseQuality,
  type ReleaseResolution,
  type ReleaseSource,
  parseReleaseQuality,
  sizeFromTitle,
} from '../../../../../shared/release/quality'

/** 画质角标的两行字：上行分辨率，下行片源；都没认出时为 null（行里不放角标内容） */
export function qualityBadge(
  quality: ReleaseQuality
): { main: string; sub: string } | null {
  if (!quality.resolution && !quality.source) return null
  return {
    main: quality.resolution ?? quality.source ?? '',
    sub: quality.resolution ? (quality.source ?? '') : '',
  }
}

/** 「最佳」版本的说明：「4K REMUX 杜比视界」；什么都没认出为空串 */
export function qualityLabel(quality: ReleaseQuality): string {
  return [
    quality.resolution,
    quality.source,
    quality.dolbyVision ? '杜比视界' : quality.hdr ? 'HDR' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * 画质最高的一条（同分取靠前的，保留来源的相关度顺序）；空列表为 null。
 * @param items 结果
 * @param titleOf 取标题
 */
export function pickBest<T>(
  items: readonly T[],
  titleOf: (item: T) => string
): { item: T; quality: ReleaseQuality } | null {
  let best: { item: T; quality: ReleaseQuality } | null = null
  for (const item of items) {
    const quality = parseReleaseQuality(titleOf(item))
    if (!best || quality.rank > best.quality.rank) best = { item, quality }
  }
  return best
}

/** 结果区的排序方式：来源默认顺序 / 画质 / 发布时间 / 体积 */
export type ReleaseSort = 'default' | 'quality' | 'date' | 'size'

/** 排序要用的字段 */
export interface SortFields {
  title: string
  datetime?: string
  /** 字节数；没有时从标题里认 */
  size?: number
}

/**
 * 按选定方式排序（不改原数组，同分保持原顺序）。
 * @param items 结果
 * @param sort 排序方式
 * @param fieldsOf 取标题、时间、体积
 */
export function sortReleases<T>(
  items: readonly T[],
  sort: ReleaseSort,
  fieldsOf: (item: T) => SortFields
): T[] {
  if (sort === 'default') return [...items]
  const score = (item: T): number => {
    const fields = fieldsOf(item)
    if (sort === 'quality') return parseReleaseQuality(fields.title).rank
    if (sort === 'size') return fields.size || sizeFromTitle(fields.title)
    const time = fields.datetime ? Date.parse(fields.datetime) : NaN
    return Number.isNaN(time) ? 0 : time
  }
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(entry => entry.item)
}
