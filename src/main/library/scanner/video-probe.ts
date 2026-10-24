/**
 * 用 ffprobe 读视频流的动态范围（HDR10 / HLG / 杜比视界 profile），解析规则见 shared/video-range。
 *
 * ffprobe 是可选依赖：程序找不到（ENOENT / 路径为空）时报告 'unavailable'，探测任务据此整轮停下、
 * 不写任何结果，装上 ffmpeg 后下次扫描再补；单个文件读坏 / 超时记为 null（本文件不再重试）。
 */
import { execFile } from 'node:child_process'

import { type VideoProbe, parseFfprobeVideo } from '../../../shared/video-range'

/** 一次探测的结果：探测到 / 不是可读的视频（null）/ 没有 ffprobe */
export type VideoProbeOutcome = VideoProbe | null | 'unavailable'

/** 运行 ffprobe，返回标准输出 */
export type RunFfprobe = (
  binary: string,
  args: string[],
  timeoutMs: number
) => Promise<string>

/** 单个文件的探测超时：网络盘上读文件头可能较慢 */
const PROBE_TIMEOUT_MS = 20_000

const runFfprobe: RunFfprobe = (binary, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout)))
    )
  })

/** createVideoProber 的输入 */
export interface VideoProberOptions {
  /** ffprobe 程序路径；空串表示没有 */
  binary: () => string | Promise<string>
  /** 运行 ffprobe（测试注入），缺省 execFile */
  run?: RunFfprobe
}

/** 创建探测函数：文件路径 → 动态范围 */
export function createVideoProber(
  options: VideoProberOptions
): (path: string) => Promise<VideoProbeOutcome> {
  const run = options.run ?? runFfprobe
  return async path => {
    const binary = await options.binary()
    if (!binary) return 'unavailable'
    let stdout: string
    try {
      stdout = await run(
        binary,
        [
          '-v',
          'error',
          '-select_streams',
          'v',
          '-show_streams',
          '-of',
          'json',
          path,
        ],
        PROBE_TIMEOUT_MS
      )
    } catch (error) {
      return (error as { code?: unknown }).code === 'ENOENT'
        ? 'unavailable'
        : null
    }
    try {
      return parseFfprobeVideo(JSON.parse(stdout))
    } catch {
      return null
    }
  }
}
