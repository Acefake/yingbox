/**
 * 用 ffprobe 读视频流的动态范围（HDR10 / HLG / 杜比视界 profile），解析规则见 shared/video-range。
 * 在媒体库 utilityProcess 里运行（engine/entry.ts 注入），ffprobe 路径向主进程要（tools-host.ts）。
 *
 * 结果分四种，探测任务据此决定写不写库：
 * - VideoProbe：读到了正片视频流；
 * - null：ffprobe 正常跑完但没有正片视频流，或明确判定为坏数据（记 ''，不再重试）；
 * - 'failed'：没能读完文件——超时被杀、权限 / I/O 错误、外置盘或网络盘暂时不在、读不到文件的非零退出，
 *   保持未探测，下一轮再试；
 * - 'unavailable'：没有 ffprobe（找不到程序或路径为空），整轮停下，装上 ffmpeg 后下次扫描再补。
 *
 * 同一进程里最多同时跑 PROBE_MAX_PROCESSES 个 ffprobe，多个库同时补探测也共用这个上限。
 */
import { execFile } from 'node:child_process'

import { type VideoProbe, parseFfprobeVideo } from '../../../shared/video-range'

/** 一次探测的结果（见文件头） */
export type VideoProbeOutcome = VideoProbe | null | 'failed' | 'unavailable'

/** 运行 ffprobe，返回标准输出；失败时抛出 execFile 的错误（带 code / killed / signal / stderr） */
export type RunFfprobe = (
  binary: string,
  args: string[],
  timeoutMs: number
) => Promise<string>

/** 单个文件的探测超时：网络盘上读文件头可能较慢 */
const PROBE_TIMEOUT_MS = 20_000

/** 同一进程里同时运行的 ffprobe 进程上限（每个只读文件头，但要起进程） */
export const PROBE_MAX_PROCESSES = 2

/** ffprobe 读完了文件、判定内容本身是坏的（不是没读到）：这类文件重试也没用 */
const CORRUPT_INPUT =
  /Invalid data found when processing input|moov atom not found/i

/** 缺省的 ffprobe 运行方式（execFile；自动字幕读字幕流也用它） */
export const runFfprobe: RunFfprobe = (binary, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) =>
        error
          ? reject(Object.assign(error, { stderr: String(stderr) }))
          : resolve(String(stdout))
    )
  })

/** execFile 失败的归类：没有程序 / 坏文件（null）/ 瞬时失败 */
function classifyFailure(error: unknown): null | 'failed' | 'unavailable' {
  const e = (error ?? {}) as {
    code?: unknown
    killed?: unknown
    signal?: unknown
    stderr?: unknown
  }
  // execFile 的 ENOENT 只来自起进程（找不到程序）；视频文件不存在是 ffprobe 的非零退出，走下面
  if (e.code === 'ENOENT') return 'unavailable'
  if (e.killed || e.signal) return 'failed'
  // 数字 code 是 ffprobe 的退出码：只有明确的坏数据才算读完了
  if (typeof e.code === 'number' && CORRUPT_INPUT.test(String(e.stderr ?? '')))
    return null
  return 'failed'
}

/** 并发上限：超出的调用排队，前一个结束后接上 */
function limiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: Array<() => void> = []
  return async task => {
    if (active < max) active++
    else await new Promise<void>(resolve => waiting.push(resolve))
    try {
      return await task()
    } finally {
      // 把名额直接交给排队的下一个；没人排队才归还
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}

/** createVideoProber 的输入 */
export interface VideoProberOptions {
  /** ffprobe 程序路径；空串表示没有 */
  binary: () => string | Promise<string>
  /** 运行 ffprobe（测试注入），缺省 execFile */
  run?: RunFfprobe
}

/** 创建探测函数：文件路径 → 动态范围。同一个探测函数的所有调用共用 PROBE_MAX_PROCESSES 上限。 */
export function createVideoProber(
  options: VideoProberOptions
): (path: string) => Promise<VideoProbeOutcome> {
  const run = options.run ?? runFfprobe
  const limit = limiter(PROBE_MAX_PROCESSES)
  return async path => {
    const binary = await options.binary()
    if (!binary) return 'unavailable'
    let stdout: string
    try {
      stdout = await limit(() =>
        run(
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
      )
    } catch (error) {
      return classifyFailure(error)
    }
    try {
      return parseFfprobeVideo(JSON.parse(stdout))
    } catch {
      // 退出码 0 但输出不是 JSON：多半是被截断，下一轮再试
      return 'failed'
    }
  }
}
