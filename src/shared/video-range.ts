/**
 * 视频动态范围（SDR / HDR10 / HLG / 杜比视界）：ffprobe 输出解析、卡片小标、播放路由依据。
 *
 * 媒体库扫描后用 ffprobe 读第一条正片视频流（跳过封面图）：
 * - side_data 里有 DOVI configuration record → 杜比视界，记下 dv_profile 与基础层兼容号；
 * - 否则看 color_transfer：smpte2084 → HDR10（含 HDR10+），arib-std-b67 → HLG，其余 SDR。
 *
 * Chromium 解不了杜比视界的增强信息，只能播基础层：Profile 5（以及兼容号为 0 的其它 profile）
 * 没有 HDR10 / SDR 兼容基础层，内置播放器会偏绿偏紫，这类视频交给 mpv（见 needsExternalPlayer）。
 */

/** 动态范围 */
export type VideoRange = 'sdr' | 'hdr10' | 'hlg' | 'dv'

/** 一个视频文件的探测结果 */
export interface VideoProbe {
  range: VideoRange
  /** 杜比视界 profile（4 / 5 / 7 / 8 / 9 / 10 …）；非杜比视界为 null */
  dvProfile: number | null
  /** 杜比视界基础层兼容号 dv_bl_signal_compatibility_id（0 无兼容、1 HDR10、2 SDR、4 HLG、6 蓝光 HDR10）；非杜比视界为 null */
  dvCompat: number | null
}

const DOVI_RECORD = 'DOVI configuration record'

const RANK: Record<VideoRange, number> = { sdr: 0, hlg: 1, hdr10: 2, dv: 3 }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null

/**
 * 解析 `ffprobe -show_streams -of json` 的输出。
 * @param json 已 JSON.parse 的输出
 * @returns 第一条正片视频流的动态范围；没有视频流或输出不像样时为 null
 */
export function parseFfprobeVideo(json: unknown): VideoProbe | null {
  if (!isRecord(json) || !Array.isArray(json.streams)) return null
  const stream = json.streams.find(
    (s): s is Record<string, unknown> =>
      isRecord(s) &&
      s.codec_type === 'video' &&
      !(isRecord(s.disposition) && s.disposition.attached_pic === 1)
  )
  if (!stream) return null
  const sideData = Array.isArray(stream.side_data_list)
    ? stream.side_data_list.filter(isRecord)
    : []
  const dovi = sideData.find(d => d.side_data_type === DOVI_RECORD)
  if (dovi) {
    return {
      range: 'dv',
      dvProfile: intOrNull(dovi.dv_profile),
      dvCompat: intOrNull(dovi.dv_bl_signal_compatibility_id),
    }
  }
  const transfer = stream.color_transfer
  const range: VideoRange =
    transfer === 'smpte2084'
      ? 'hdr10'
      : transfer === 'arib-std-b67'
        ? 'hlg'
        : 'sdr'
  return { range, dvProfile: null, dvCompat: null }
}

/**
 * 内置播放器（Chromium）放不对颜色、要交给 mpv：杜比视界 Profile 5，或基础层兼容号为 0 的其它 profile。
 * Profile 7 的基础层是 HDR10（兼容号 6），按 HDR10 播。
 */
export function needsExternalPlayer(
  probe: Pick<VideoProbe, 'dvProfile' | 'dvCompat'> | null | undefined
): boolean {
  if (!probe || probe.dvProfile === null) return false
  if (probe.dvProfile === 5) return true
  return probe.dvProfile !== 7 && probe.dvCompat === 0
}

/** 卡片 / 详情上的小标：DV、HDR、HLG；SDR 与未知不显示 */
export function videoRangeBadge(range: VideoRange | null | undefined): string {
  if (range === 'dv') return 'DV'
  if (range === 'hdr10') return 'HDR'
  if (range === 'hlg') return 'HLG'
  return ''
}

/** 详情文件行的小标：杜比视界带 profile（「DV P5」），其余同 videoRangeBadge */
export function videoProbeTag(probe: VideoProbe | null | undefined): string {
  if (!probe) return ''
  const badge = videoRangeBadge(probe.range)
  return probe.range === 'dv' && probe.dvProfile !== null
    ? `${badge} P${probe.dvProfile}`
    : badge
}

/** SQL 里按档位取最好一档时用的排名：DV > HDR10 > HLG > SDR（多个文件取最好一档，见 catalog/query） */
export const VIDEO_RANGE_RANK: Readonly<Record<VideoRange, number>> = RANK
