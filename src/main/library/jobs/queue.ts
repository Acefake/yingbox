/**
 * 通用任务队列：优先级、并发上限、同 key 互斥、取消、失败指数退避重试，状态持久化在 jobs 表。
 *
 * 本 PR 用于扫描、解析和指纹；P3 识别注册新的任务类型即可复用。
 * 任务处理函数应当幂等：引擎崩溃或重启后，没跑完的任务会从头再跑一次。
 */
import type { JobEvent } from '../../../shared/library/ipc'
import type { JobRecord, JobSpec, JobStore, PayloadMerger } from './job-store'

/** 处理函数拿到的上下文。 */
export interface JobContext {
  job: JobRecord
  /** 取消信号；处理函数应在合适的检查点调用 signal.throwIfAborted()。 */
  signal: AbortSignal
  /** 上报进度（0–1）。 */
  progress(fraction: number): void
}

/** 任务处理函数。 */
export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<void>

/** 注册任务类型时的选项。 */
export interface JobTypeOptions {
  /** 同 key 任务排队时如何合并载荷；缺省用新载荷覆盖。 */
  merge?: PayloadMerger
}

/** 队列参数。 */
export interface JobQueueOptions {
  /** 同时运行的任务数上限，默认 2。 */
  concurrency?: number
  /** 第 n 次失败后的退避毫秒数，默认 2^(n-1) 秒、最多 5 分钟。 */
  backoff?: (attempt: number) => number
  /** 状态变化回调（推给订阅方）。 */
  onEvent?: (event: JobEvent) => void
  /** 时钟，测试注入。 */
  now?: () => number
}

/** 不应重试的错误：参数错、对象不存在等。处理函数抛出它会直接失败。 */
export class PermanentJobError extends Error {
  override name = 'PermanentJobError'
}

const defaultBackoff = (attempt: number): number =>
  Math.min(1000 * 2 ** (attempt - 1), 5 * 60_000)

/** 持久化任务队列。 */
export class JobQueue {
  private readonly handlers = new Map<
    string,
    { handler: JobHandler; options: JobTypeOptions }
  >()
  private readonly running = new Map<
    number,
    { controller: AbortController; key: string | null; done: Promise<void> }
  >()
  private readonly concurrency: number
  private readonly backoff: (attempt: number) => number
  private readonly now: () => number
  private timer: ReturnType<typeof setTimeout> | undefined
  private started = false
  private stopping = false

  constructor(
    private readonly store: JobStore,
    private readonly options: JobQueueOptions = {}
  ) {
    this.concurrency = options.concurrency ?? 2
    this.backoff = options.backoff ?? defaultBackoff
    this.now = options.now ?? Date.now
  }

  /** 注册一种任务类型。必须在 start 之前注册完。 */
  register(
    type: string,
    handler: JobHandler,
    options: JobTypeOptions = {}
  ): void {
    this.handlers.set(type, { handler, options })
  }

  /** 恢复上次中断的任务并开始调度。 */
  start(): void {
    if (this.started) return
    this.started = true
    this.store.recoverInterrupted(this.now())
    this.pump()
  }

  /** 入队并尝试立即调度，返回（可能是合并后的）任务记录。 */
  enqueue(spec: JobSpec): JobRecord {
    const type = this.handlers.get(spec.type)
    if (!type) throw new Error(`未注册的任务类型：${spec.type}`)
    const job = this.store.enqueue(spec, this.now(), type.options.merge)
    this.emit(job, 'queued')
    this.pump()
    return job
  }

  /** 取消任务：排队中的直接取消，运行中的发出取消信号。返回是否找到可取消的任务。 */
  cancel(id: number): boolean {
    const active = this.running.get(id)
    if (active) {
      active.controller.abort(new DOMException('任务已取消', 'AbortError'))
      return true
    }
    const job = this.store.get(id)
    if (job && this.store.cancelQueued(id, this.now())) {
      this.emit(job, 'cancelled')
      return true
    }
    return false
  }

  /** 停止调度并取消运行中的任务，等它们退出。运行中的任务保持“运行中”，下次启动时恢复。 */
  async stop(): Promise<void> {
    this.stopping = true
    clearTimeout(this.timer)
    for (const { controller } of this.running.values()) {
      controller.abort(new DOMException('引擎退出', 'AbortError'))
    }
    await Promise.all([...this.running.values()].map(r => r.done))
  }

  /** 当前没有运行中的任务、也没有到期的排队任务时 resolve（测试与基准用）。 */
  async idle(): Promise<void> {
    while (this.running.size) {
      await Promise.race([...this.running.values()].map(r => r.done))
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  private emit(
    job: Pick<JobRecord, 'id' | 'type'>,
    state: JobEvent['state'],
    extra: Partial<JobEvent> = {}
  ): void {
    this.options.onEvent?.({
      type: 'job',
      jobId: job.id,
      jobType: job.type,
      state,
      ...extra,
    })
  }

  /** 尽量多地启动可执行任务，并为最近的退避任务设定唤醒定时器。 */
  private pump(): void {
    if (!this.started || this.stopping) return
    const busy = new Set<string>()
    for (const r of this.running.values()) if (r.key !== null) busy.add(r.key)
    while (this.running.size < this.concurrency) {
      const job = this.store.claimNext(this.now(), busy)
      if (!job) break
      if (job.key !== null) busy.add(job.key)
      this.run(job)
    }
    clearTimeout(this.timer)
    this.timer = undefined
    const next = this.store.nextRunAfter(this.now())
    if (next !== undefined) {
      this.timer = setTimeout(() => this.pump(), Math.max(0, next - this.now()))
    }
  }

  private run(job: JobRecord): void {
    const controller = new AbortController()
    const entry = this.handlers.get(job.type)
    this.emit(job, 'running', { progress: 0 })
    const ctx: JobContext = {
      job,
      signal: controller.signal,
      progress: fraction => this.emit(job, 'running', { progress: fraction }),
    }
    const done = (async () => {
      // 先让出一次，保证 running 表在任务结束清理之前已登记
      await null
      try {
        if (!entry) throw new PermanentJobError(`未注册的任务类型：${job.type}`)
        await entry.handler(job.payload, ctx)
        this.store.finish(job.id, 'done', this.now())
        this.emit(job, 'done', { progress: 1 })
      } catch (error) {
        this.settleFailure(job, controller.signal, error)
      } finally {
        this.running.delete(job.id)
        this.pump()
      }
    })()
    this.running.set(job.id, { controller, key: job.key, done })
  }

  private settleFailure(
    job: JobRecord,
    signal: AbortSignal,
    error: unknown
  ): void {
    const message = error instanceof Error ? error.message : String(error)
    if (signal.aborted) {
      // 引擎退出：保持 running，下次启动恢复；用户取消：记为取消
      if (this.stopping) return
      this.store.finish(job.id, 'cancelled', this.now())
      this.emit(job, 'cancelled')
      return
    }
    const permanent = error instanceof PermanentJobError
    if (!permanent && job.attempts < job.maxAttempts) {
      const runAfter = this.now() + this.backoff(job.attempts)
      this.store.retry(job.id, runAfter, this.now(), message)
      this.emit(job, 'queued', { error: message })
      return
    }
    this.store.finish(job.id, 'failed', this.now(), message)
    this.emit(job, 'failed', { error: message })
  }
}
