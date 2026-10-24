/**
 * 检测队列：一次只检测一季，其余排队；同一季重复请求复用同一次；可取消（排队中的直接移除，
 * 进行中的杀掉 ffmpeg）。不依赖 electron，真正的检测与进度广播由调用方注入。
 */
import type {
  IntroDetectProgress,
  IntroDetectRequest,
  IntroDetectResult,
} from '../../shared/contract/intro-detect'

/** 队列依赖：怎么检测一季、怎么报进度 */
export interface QueueDeps {
  run: (
    request: IntroDetectRequest,
    signal: AbortSignal,
    onStep: (done: number, total: number) => void
  ) => Promise<IntroDetectResult>
  onProgress: (progress: IntroDetectProgress) => void
}

interface Job {
  request: IntroDetectRequest
  controller: AbortController
  promise: Promise<IntroDetectResult>
  resolve: (result: IntroDetectResult) => void
}

/** 检测队列 */
export interface DetectQueue {
  /** 排队检测一季；同一 key 已在队里 / 进行中时返回那一次的结果 */
  enqueue: (request: IntroDetectRequest) => Promise<IntroDetectResult>
  /** 取消某一季；不在队里返回 false */
  cancel: (key: string) => boolean
  /** 全部取消（退出时） */
  cancelAll: () => void
  /** 是否有检测在跑 */
  busy: () => boolean
}

export function createDetectQueue(deps: QueueDeps): DetectQueue {
  const waiting: Job[] = []
  let current: Job | null = null

  const report = (
    job: Job,
    phase: IntroDetectProgress['phase'],
    done = 0,
    total = 0
  ): void =>
    deps.onProgress({
      key: job.request.key,
      label: job.request.label,
      phase,
      done,
      total,
    })

  const cancelled = (key: string): IntroDetectResult => ({
    key,
    success: false,
    cancelled: true,
  })

  async function pump(): Promise<void> {
    if (current) return
    const job = waiting.shift()
    if (!job) return
    current = job
    report(job, 'running')
    let result: IntroDetectResult
    try {
      result = await deps.run(job.request, job.controller.signal, (d, t) =>
        report(job, 'running', d, t)
      )
    } catch (error) {
      result = {
        key: job.request.key,
        success: false,
        error: (error as Error).message,
      }
    }
    if (job.controller.signal.aborted) result = cancelled(job.request.key)
    current = null
    report(job, 'finished')
    job.resolve(result)
    void pump()
  }

  const find = (key: string): Job | undefined =>
    current?.request.key === key
      ? current
      : waiting.find(j => j.request.key === key)

  return {
    enqueue(request) {
      const existing = find(request.key)
      if (existing) return existing.promise
      let resolve!: (result: IntroDetectResult) => void
      const promise = new Promise<IntroDetectResult>(r => {
        resolve = r
      })
      const job: Job = {
        request,
        controller: new AbortController(),
        promise,
        resolve,
      }
      waiting.push(job)
      report(job, 'queued')
      void pump()
      return promise
    },
    cancel(key) {
      const index = waiting.findIndex(j => j.request.key === key)
      if (index >= 0) {
        const [job] = waiting.splice(index, 1)
        report(job, 'finished')
        job.resolve(cancelled(key))
        return true
      }
      if (current?.request.key !== key) return false
      current.controller.abort()
      return true
    },
    cancelAll() {
      for (const job of waiting.splice(0)) {
        report(job, 'finished')
        job.resolve(cancelled(job.request.key))
      }
      current?.controller.abort()
    },
    busy: () => current !== null,
  }
}
