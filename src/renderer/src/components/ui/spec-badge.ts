/**
 * 规格标签（UiSpecBadge）的取值：标签样式 + 文字，以及从视频探测结果得出标签的纯规则。
 */
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
