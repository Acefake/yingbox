/**
 * 解析 ffprobe 的 JSON 输出，识别 HDR 类型与杜比视界 Profile（纯函数，主进程与媒体库引擎共用）。
 *
 * 必须用 `-show_streams`：DOVI configuration record 在每路流的 side_data_list 里，
 * 用 `-show_entries stream=...` 限定字段时 ffprobe 不输出 side data，P5 会被当成 SDR。
 */
import type {
  DoviRecord,
  HdrKind,
  VideoHdrInfo,
} from '../../shared/dolby-vision'

/** ffprobe 参数（文件路径接在最后）：只看第一路视频流也要整段 side data，所以不限定字段。 */
export const FFPROBE_ARGS: readonly string[] = [
  '-v',
  'error',
  '-print_format',
  'json',
  '-show_streams',
  '-show_format',
  '-select_streams',
  'v',
]

/** DOVI 配置记录的 side_data_type 文案（ffprobe 原文）。 */
const DOVI_SIDE_DATA = 'DOVI configuration record'
/** HDR10+ 动态元数据的 side_data_type 前缀（少数容器在流级别给出）。 */
const HDR10_PLUS_SIDE_DATA = /SMPTE ?2094-40|HDR10\+/i

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toNumber = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/** 主视频流：第一路不是封面图（attached_pic）的视频流。 */
function mainVideoStream(streams: unknown[]): Json | undefined {
  return streams.filter(isRecord).find(s => {
    if (s.codec_type !== undefined && s.codec_type !== 'video') return false
    const disposition = isRecord(s.disposition) ? s.disposition : {}
    return toNumber(disposition.attached_pic) !== 1
  })
}

/** 从 side_data_list 读 DOVI 配置记录；没有或字段不全返回 undefined。 */
export function parseDoviRecord(stream: Json): DoviRecord | undefined {
  const list = Array.isArray(stream.side_data_list) ? stream.side_data_list : []
  const raw = list
    .filter(isRecord)
    .find(d => d.side_data_type === DOVI_SIDE_DATA)
  if (!raw) return undefined
  const profile = toNumber(raw.dv_profile)
  if (profile === undefined) return undefined
  return {
    profile,
    level: toNumber(raw.dv_level) ?? 0,
    rpu: toNumber(raw.rpu_present_flag) === 1,
    el: toNumber(raw.el_present_flag) === 1,
    bl: toNumber(raw.bl_present_flag) === 1,
    compatId: toNumber(raw.dv_bl_signal_compatibility_id) ?? 0,
  }
}

/** 按传输特性判断流本身（不看杜比视界）的动态范围。 */
function baseHdrOf(stream: Json): Exclude<HdrKind, 'dolby-vision'> {
  const list = Array.isArray(stream.side_data_list) ? stream.side_data_list : []
  const hdr10Plus = list
    .filter(isRecord)
    .some(d => HDR10_PLUS_SIDE_DATA.test(String(d.side_data_type ?? '')))
  if (stream.color_transfer === 'smpte2084')
    return hdr10Plus ? 'hdr10+' : 'hdr10'
  if (stream.color_transfer === 'arib-std-b67') return 'hlg'
  return 'sdr'
}

/** 兼容层 id → 基础层可直接显示的动态范围；0（P5）没有兼容层。 */
function compatBase(
  dovi: DoviRecord,
  fallback: Exclude<HdrKind, 'dolby-vision'>
): Exclude<HdrKind, 'dolby-vision'> | undefined {
  switch (dovi.compatId) {
    case 0:
      return undefined
    case 1:
    case 6:
      return 'hdr10'
    case 2:
      return 'sdr'
    case 4:
      return 'hlg'
    default:
      return fallback
  }
}

/** 人读的 Profile 写法：P8 带兼容层小数（8.1 / 8.2 / 8.4），其余只写主号。 */
export function doviLabel(dovi: DoviRecord): string {
  if (dovi.profile === 8 && dovi.compatId > 0)
    return `Profile 8.${dovi.compatId}`
  return `Profile ${dovi.profile}`
}

/**
 * 解析 ffprobe JSON（FFPROBE_ARGS 的输出），给出主视频流的 HDR / 杜比视界识别结果。
 * 没有视频流或 JSON 坏了返回 null；有视频流但没有 side data 时按传输特性给 SDR / HDR10 / HLG。
 */
export function parseFfprobeJson(text: string): VideoHdrInfo | null {
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(root) || !Array.isArray(root.streams)) return null
  const stream = mainVideoStream(root.streams)
  if (!stream) return null

  const width = toNumber(stream.width)
  const height = toNumber(stream.height)
  const format = isRecord(root.format) ? root.format : {}
  const duration = toNumber(format.duration) ?? toNumber(stream.duration)
  const extra = {
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(duration && duration > 0 ? { duration } : {}),
  }

  const own = baseHdrOf(stream)
  const dovi = parseDoviRecord(stream)
  if (!dovi) return { hdr: own, needsRpuRebuild: false, ...extra }

  const baseLayer = compatBase(dovi, own)
  return {
    hdr: 'dolby-vision',
    dovi,
    doviLabel: doviLabel(dovi),
    // 基础层存在却没有兼容层（compat id 0）且带 RPU：只有按 RPU 重建才有正确色彩
    needsRpuRebuild: dovi.bl && dovi.rpu && dovi.compatId === 0,
    ...(baseLayer ? { baseLayer } : {}),
    ...extra,
  }
}
