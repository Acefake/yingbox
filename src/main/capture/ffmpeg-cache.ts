/**
 * ffmpeg 路径缓存：探测是同步的（会卡主进程），所以缓存结果。
 * 找到的路径一直沿用，直到被作废（用户改了工具路径、或按缓存路径启动失败）；
 * 没找到时只缓存一段时间，之后重新探测（用户可能刚装好 ffmpeg）。
 */

/** 缓存对外的操作 */
export interface FfmpegCache {
  /** 当前可用的 ffmpeg；找不到返回空串 */
  get(): string
  /** 作废缓存，下次 get 重新探测 */
  invalidate(): void
}

/**
 * 建一个 ffmpeg 路径缓存。
 * @param probe 同步探测 ffmpeg，找不到返回空串（可以抛错，按没找到处理）
 * @param retryMs 没找到时多久内不再重新探测
 * @param now 当前时间（测试注入）
 */
export function createFfmpegCache(
  probe: () => string,
  retryMs: number,
  now: () => number = Date.now
): FfmpegCache {
  let cached: { path: string; at: number } | null = null
  return {
    get() {
      const at = now()
      if (cached && (cached.path || at - cached.at < retryMs)) {
        return cached.path
      }
      let path = ''
      try {
        path = probe()
      } catch {
        path = ''
      }
      cached = { path, at }
      return path
    },
    invalidate() {
      cached = null
    },
  }
}
