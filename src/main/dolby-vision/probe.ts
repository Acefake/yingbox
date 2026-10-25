/**
 * 开播前识别本地文件（主进程，ffprobe 只读文件头）：动态范围 + 重建要用的片长与尺寸。
 *
 * 动态范围的解析与媒体库共用 shared/video-range（ADR-0016 的 parseFfprobeVideo / mainVideoStream），
 * 这里只多读片长（format.duration，mkv 的视频流没有 duration）与宽高。
 * 必须用 `-show_streams`：DOVI configuration record 在 side_data_list 里，`-show_entries` 限定字段时不输出。
 */
import {
  type VideoProbe,
  mainVideoStream,
  parseFfprobeVideo,
} from '../../shared/video-range'

import { type ToolRunner, runWithTimeout } from './tool'

/** ffprobe 参数（文件路径接在最后）：整段视频流信息 + 容器信息（片长） */
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

/** ffprobe 读文件头的时限：本地盘通常几十毫秒，网络盘留足余量 */
const PROBE_TIMEOUT_MS = 15_000

/** 一个本地文件的识别结果 */
export interface RebuildProbe {
  /** 动态范围（与媒体库存的同一形状） */
  video: VideoProbe
  /** 片长（秒）；读不到时没有 */
  duration?: number
  width?: number
  height?: number
}

const positive = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * 解析 FFPROBE_ARGS 的 JSON 输出。
 * @returns 识别结果；没有正片视频流为 null；输出不是 JSON（多半被截断）为 undefined
 */
export function parseRebuildProbe(
  text: string
): RebuildProbe | null | undefined {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return undefined
  }
  const video = parseFfprobeVideo(json)
  const stream = mainVideoStream(json)
  if (!video || !stream) return null
  const format = (json as { format?: Record<string, unknown> }).format ?? {}
  const duration = positive(format.duration) ?? positive(stream.duration)
  const width = positive(stream.width)
  const height = positive(stream.height)
  return {
    video,
    ...(duration ? { duration } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  }
}

/**
 * 用 ffprobe 识别一个本地视频文件。
 * @returns 识别结果；ffprobe 正常跑完但没有视频流为 null；
 *   ffprobe 不在、超时、非零退出或输出不完整为 undefined（没探测成功，调用方不要缓存）
 */
export async function probeForRebuild(
  file: string,
  ffprobe: string,
  run: ToolRunner = runWithTimeout
): Promise<RebuildProbe | null | undefined> {
  const { code, stdout } = await run(
    ffprobe,
    [...FFPROBE_ARGS, file],
    PROBE_TIMEOUT_MS
  )
  return code === 0 ? parseRebuildProbe(stdout) : undefined
}
