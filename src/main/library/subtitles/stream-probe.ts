/**
 * 用 ffprobe 读视频的字幕流（自动字幕判断有没有中文内封字幕）。ffprobe 路径和动态范围探测一样向主进程要。
 * 没有 ffprobe、读失败、输出不是 JSON 都返回 null（当作不知道，接着看外挂字幕和去搜）。
 */
import { type RunFfprobe, runFfprobe } from '../scanner/video-probe'

const TIMEOUT_MS = 20_000

/** 创建字幕流探测函数：文件路径 → ffprobe JSON（只含字幕流）。 */
export function createStreamProber(options: {
  binary: () => string | Promise<string>
  run?: RunFfprobe
}): (path: string) => Promise<unknown> {
  const run = options.run ?? runFfprobe
  return async path => {
    const binary = await options.binary()
    if (!binary) return null
    try {
      const stdout = await run(
        binary,
        [
          '-v',
          'error',
          '-select_streams',
          's',
          '-show_streams',
          '-of',
          'json',
          path,
        ],
        TIMEOUT_MS
      )
      return JSON.parse(stdout) as unknown
    } catch {
      return null
    }
  }
}
