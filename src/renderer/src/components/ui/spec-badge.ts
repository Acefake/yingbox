/**
 * 规格标签（UiSpecBadge）的取值：标签样式 + 文字，以及得出标签的纯规则（全应用唯一的一份映射）：
 * - 视频探测结果（动态范围、杜比视界 profile）；
 * - 发布名 / 文件名 / 在线源备注里的常见写法（4K、1080P、杜比视界、HDR、全景声、中字），
 *   识别用 shared/release/quality.ts（全应用唯一的一份）；
 * - 片库条目：探测到的动态范围优先，其余看视频文件名。
 * 标签按 Apple TV 的顺序排：分辨率 → 动态范围 → DOLBY ATMOS → 中字。
 */
import { parseReleaseQuality } from '../../../../shared/release/quality'
import type { VideoProbe, VideoRange } from '../../../../shared/video-range'

/** 标签样式：实心小方块 / 描边小方块 / 分级圆标 / DOLBY 双行文字标 */
export type SpecVariant = 'solid' | 'outline' | 'rating' | 'dolby'

/** 一枚规格标签；dolby 的 text 是第二行（VISION / ATMOS） */
export interface SpecBadge {
  variant: SpecVariant
  text: string
}

/**
 * 动态范围的标签：杜比视界 → DOLBY VISION 字标，HDR10 / HLG → 实心小方块；SDR 与未知不显示。
 * @param range 探测到的动态范围
 */
export function videoRangeSpec(
  range: VideoRange | null | undefined
): SpecBadge | null {
  if (range === 'dv') return { variant: 'dolby', text: 'VISION' }
  if (range === 'hdr10') return { variant: 'solid', text: 'HDR10' }
  if (range === 'hlg') return { variant: 'solid', text: 'HLG' }
  return null
}

/**
 * 详情文件行的标签：动态范围标签，杜比视界另带 profile 文字（「P5」）。
 * @param probe 文件的探测结果
 * @returns SDR、未知或没探测过时为 null
 */
export function videoProbeSpec(
  probe: VideoProbe | null | undefined
): { spec: SpecBadge; profile: string } | null {
  const spec = videoRangeSpec(probe?.range)
  if (!probe || !spec) return null
  const profile =
    probe.range === 'dv' && probe.dvProfile !== null
      ? `P${probe.dvProfile}`
      : ''
  return { spec, profile }
}

/**
 * 发布名、文件名、在线源备注里认出的规格标签：分辨率（4K / 1080P）、动态范围（DOLBY VISION / HDR）、
 * 音轨（DOLBY ATMOS）、中文字幕（中字）。只看文字，认不出的不显示；杜比视界和 HDR 同时出现时只留杜比视界。
 * @param texts 要看的文字（几段一起看，任何一段出现都算）
 */
export function releaseSpecs(texts: readonly string[]): SpecBadge[] {
  const parsed = texts.map(parseReleaseQuality)
  const has = (test: (q: (typeof parsed)[number]) => boolean): boolean =>
    parsed.some(test)
  const specs: SpecBadge[] = []
  if (has(q => q.height === 2160)) specs.push({ variant: 'solid', text: '4K' })
  else if (has(q => q.height === 1080))
    specs.push({ variant: 'outline', text: '1080P' })
  if (has(q => q.dolbyVision)) specs.push({ variant: 'dolby', text: 'VISION' })
  else if (has(q => q.hdr)) specs.push({ variant: 'solid', text: 'HDR' })
  if (has(q => q.atmos)) specs.push({ variant: 'dolby', text: 'ATMOS' })
  if (has(q => q.chineseSubs)) specs.push({ variant: 'outline', text: '中字' })
  return specs
}

/** 路径的最后一段（Windows / POSIX 分隔符都认）：目录名里的 4K 不算。 */
const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/**
 * 片库条目的规格标签：只出 4K（不出 1080P）；动态范围探测过就以探测为准（SDR 不出），
 * 没探测过才看文件名；全景声、中字看文件名。
 * @param input.videoRange 条目全部文件里最好的一档动态范围；没探测过为 undefined / null
 * @param input.fileNames 视频文件路径或文件名
 */
export function mediaSpecs(input: {
  videoRange?: VideoRange | null
  fileNames: readonly string[]
}): SpecBadge[] {
  const fromNames = releaseSpecs(input.fileNames.map(baseName)).filter(
    spec => spec.text !== '1080P'
  )
  if (!input.videoRange) return fromNames
  const isRange = (spec: SpecBadge): boolean =>
    spec.text === 'VISION' || spec.text === 'HDR'
  const range = videoRangeSpec(input.videoRange)
  const at = fromNames.findIndex(spec => spec.text === '4K') + 1
  const rest = fromNames.filter(spec => !isRange(spec))
  if (range) rest.splice(at, 0, range)
  return rest
}
