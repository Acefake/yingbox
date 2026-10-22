/**
 * 网盘上读视频内容的规矩：读一次就是一次网络下载（CloudDrive2 等挂载会真的去拉数据）。
 *
 * - 后台批量读（扫描后的指纹任务、移动检测的指纹）：网盘上一律跳过；
 * - 识别时按需读（时长探测、OpenSubtitles 哈希）：网盘上串行、两次之间至少隔 intervalMs。
 * 本地盘照常直读。
 */

/** 网盘上两次按需读之间的最短间隔。 */
export const CLOUD_READ_INTERVAL_MS = 1000

/** 串行限速：任务一个接一个跑，上一个结束到下一个开始至少隔 intervalMs。 */
export class Pacer {
  private tail: Promise<unknown> = Promise.resolve()
  private lastEnd = -Infinity

  constructor(private readonly intervalMs = CLOUD_READ_INTERVAL_MS) {}

  /** 排队执行 task，返回它的结果（失败照样抛给调用方，不影响后面的任务）。 */
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      const wait = this.lastEnd + this.intervalMs - Date.now()
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
      try {
        return await task()
      } finally {
        this.lastEnd = Date.now()
      }
    })
    this.tail = next.catch(() => {})
    return next
  }
}

/** 按路径读视频内容的函数（指纹、时长）。 */
export type ContentRead<T> = (path: string) => Promise<T | undefined>

/**
 * 包一层网盘规矩：isCloudPath(path) 为真时 pacer 缺省就跳过（返回 undefined），给了 pacer 就限速读。
 */
export function forCloud<T>(
  read: ContentRead<T>,
  isCloudPath: (path: string) => Promise<boolean>,
  pacer?: Pacer
): ContentRead<T> {
  return async path => {
    if (!(await isCloudPath(path))) return read(path)
    return pacer ? pacer.run(() => read(path)) : undefined
  }
}
