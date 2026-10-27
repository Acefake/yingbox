/**
 * 网盘结果的画质规则（纯函数）：从 115 分享 / 磁力的标题认出分辨率与片源（4K REMUX、1080 BD…），
 * 给结果行左侧的画质角标、Hero 上的「最佳版本」和结果区的排序用。只看文字，认不出的不猜。
 */

/** 分辨率档：4K / 1080 / 720 */
export type ReleaseResolution = '4K' | '1080' | '720'

/** 片源档：原盘重封装 / 蓝光 / 网络版 / 电视录制 */
export type ReleaseSource = 'REMUX' | 'BD' | 'WEB' | 'HDTV'

/** 从标题认出的画质 */
export interface ReleaseQuality {
  resolution: ReleaseResolution | null
  source: ReleaseSource | null
  /** 杜比视界 */
  dolbyVision: boolean
  /** HDR（杜比视界之外的 HDR10 / HDR） */
  hdr: boolean
  /** 排序分：分辨率 > 片源 > 动态范围；什么都没认出为 0 */
  rank: number
}

const RESOLUTIONS: Array<[ReleaseResolution, RegExp, number]> = [
  ['4K', /(^|[^a-z0-9])(2160[pi]|4k|uhd)([^a-z0-9]|$)|ultra[\s._-]?hd/i, 3],
  ['1080', /(^|\D)1080[pi]?(?!\d)/i, 2],
  ['720', /(^|\D)720[pi](?!\d)/i, 1],
]

// 片源按优先级认：REMUX 先于 BD（Remux 标题里常同时有 BluRay）；BD 认 BluRay / BDRip / BD1080P / 蓝光 / 原盘
const SOURCES: Array<[ReleaseSource, RegExp, number]> = [
  ['REMUX', /remux/i, 4],
  ['BD', /blu-?ray|bdrip|bdmv|蓝光|原盘|(^|[^a-z])bd(?=[^a-z]|$)/i, 3],
  ['WEB', /web-?dl|webrip|(^|[^a-z])web([^a-z]|$)/i, 2],
  ['HDTV', /hdtv/i, 1],
]

const DV_RE = /杜比视界|dolby[\s._-]*vision|(^|[^a-z])dv([^a-z]|$)|dovi/i
const HDR_RE = /(^|[^a-z])hdr(10\+?)?([^a-z]|$)/i

/**
 * 认出标题里的画质。
 * @param title 分享 / 磁力标题
 */
export function parseReleaseQuality(title: string): ReleaseQuality {
  const res = RESOLUTIONS.find(([, re]) => re.test(title))
  const src = SOURCES.find(([, re]) => re.test(title))
  const dolbyVision = DV_RE.test(title)
  const hdr = !dolbyVision && HDR_RE.test(title)
  const rank =
    (res?.[2] ?? 0) * 100 +
    (src?.[2] ?? 0) * 10 +
    (dolbyVision ? 2 : hdr ? 1 : 0)
  return {
    resolution: res?.[0] ?? null,
    source: src?.[0] ?? null,
    dolbyVision,
    hdr,
    rank,
  }
}

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

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(TB|GB|MB|T|G|M)(?![a-z])/i

/** 标题里写的体积（「106.6 GB」「73.3G」）→ 字节数；没写为 0 */
export function sizeFromTitle(title: string): number {
  const hit = SIZE_RE.exec(title)
  if (!hit) return 0
  const unit = hit[2].toUpperCase()[0]
  const power = unit === 'T' ? 4 : unit === 'G' ? 3 : 2
  return Math.round(Number(hit[1]) * 1024 ** power)
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
