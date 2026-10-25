/**
 * 视频动态范围（SDR / HDR10 / HLG / 杜比视界）：ffprobe 输出解析、卡片小标、播放路由依据。
 *
 * 媒体库扫描后用 ffprobe 读第一条正片视频流（跳过封面图）：
 * - side_data 里有 DOVI configuration record → 杜比视界，记下 dv_profile 与基础层兼容号；
 * - 否则看 color_transfer：smpte2084 → HDR10（含 HDR10+），arib-std-b67 → HLG，其余 SDR。
 *
 * Chromium 解不了杜比视界的增强信息，只能播基础层：Profile 5（以及兼容号为 0 的其它 profile）
 * 没有 HDR10 / SDR 兼容基础层，内置播放器直接放会偏绿偏紫（判定见 needsDvColorFix）。
 * 这类视频先按设置交给 mpv，进了内置播放器再由主进程 libplacebo 重建（决策链见 player/utils/playback-route.ts）。
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
 * ffprobe JSON 里的第一条正片视频流（跳过封面图）。
 * @param json 已 JSON.parse 的 `ffprobe -show_streams -of json` 输出
 * @returns 该视频流；没有视频流或输出不像样时为 undefined
 */
export function mainVideoStream(
  json: unknown
): Record<string, unknown> | undefined {
  if (!isRecord(json) || !Array.isArray(json.streams)) return undefined
  return json.streams.find(
    (s): s is Record<string, unknown> =>
      isRecord(s) &&
      s.codec_type === 'video' &&
      !(isRecord(s.disposition) && s.disposition.attached_pic === 1)
  )
}

/**
 * 解析 `ffprobe -show_streams -of json` 的输出。
 * @param json 已 JSON.parse 的输出
 * @returns 第一条正片视频流的动态范围；没有视频流或输出不像样时为 null
 */
export function parseFfprobeVideo(json: unknown): VideoProbe | null {
  const stream = mainVideoStream(json)
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
 * 内置播放器（Chromium）直接放颜色不对、要先处理：杜比视界 Profile 5，或基础层兼容号为 0 的其它 profile。
 * 处理方式按 playback-route.ts 的决策链：先按设置交给 mpv，进了内置播放器再由主进程重建。
 * Profile 7 的基础层是 HDR10（兼容号 6），按 HDR10 播。
 */
export function needsDvColorFix(
  probe: Pick<VideoProbe, 'dvProfile' | 'dvCompat'> | null | undefined
): boolean {
  if (!probe || probe.dvProfile === null) return false
  if (probe.dvProfile === 5) return true
  return probe.dvProfile !== 7 && probe.dvCompat === 0
}

/** SQL 里按档位取最好一档时用的排名：DV > HDR10 > HLG > SDR（多个文件取最好一档，见 catalog/query） */
export const VIDEO_RANGE_RANK: Readonly<Record<VideoRange, number>> = RANK
