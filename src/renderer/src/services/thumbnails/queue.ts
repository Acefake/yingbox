/**
 * 缩略图请求队列（纯逻辑，测试时注入 run / put）：
 * 同一张（来源 + 宽度）只处理一次，并发受限，做完的记在内存里不再请求。
 * 失败不记，下次挂载时会重试。
 */
export type RunResult = { hit: true } | { data: ArrayBuffer }

export interface ThumbQueueDeps {
  /** 交给 Worker 生成 */
  run(source: string, width: number): Promise<RunResult>
  /** 交给主进程落盘 */
  put(source: string, width: number, data: Uint8Array): Promise<boolean>
  /** 同时处理几张 */
  concurrency?: number
  /** 「已完成」记多少条（超出按先进先出忘掉） */
  rememberLimit?: number
}

export interface ThumbQueue {
  ensure(source: string, width: number): Promise<void>
  /** 测试 / 诊断：当前正在处理与排队的数量 */
  stats(): { running: number; waiting: number; done: number }
}

export function createThumbQueue(deps: ThumbQueueDeps): ThumbQueue {
  const concurrency = Math.max(1, deps.concurrency ?? 2)
  const rememberLimit = deps.rememberLimit ?? 5000
  const done = new Set<string>()
  const pending = new Map<string, Promise<void>>()
  const waiting: Array<() => void> = []
  let running = 0

  const markDone = (key: string): void => {
    done.add(key)
    if (done.size > rememberLimit)
      done.delete(done.values().next().value as string)
  }

  async function slot<T>(task: () => Promise<T>): Promise<T> {
    if (running >= concurrency)
      await new Promise<void>(resolve => waiting.push(resolve))
    running++
    try {
      return await task()
    } finally {
      running--
      waiting.shift()?.()
    }
  }

  async function process(
    source: string,
    width: number,
    key: string
  ): Promise<void> {
    try {
      const result = await slot(() => deps.run(source, width))
      if ('data' in result) {
        const stored = await deps.put(
          source,
          width,
          new Uint8Array(result.data)
        )
        if (!stored) return
      }
      markDone(key)
    } catch {
      // 原图取不到 / 解码失败：不记完成，<img> 仍显示原图或占位
    } finally {
      pending.delete(key)
    }
  }

  return {
    ensure(source, width) {
      const key = `${width}\n${source}`
      if (done.has(key)) return Promise.resolve()
      let task = pending.get(key)
      if (!task) {
        task = process(source, width, key)
        pending.set(key, task)
      }
      return task
    },
    stats: () => ({ running, waiting: waiting.length, done: done.size }),
  }
}
