/**
 * utilityProcess 宿主：主进程里两个后台进程（在线引擎 yingbox-engine、媒体库引擎 yingbox-library）
 * 共用的生命周期与调用表。与 Electron 无关，fork 以参数注入，便于单测。
 *
 * - 按需启动：第一次调用（或 start()）才 fork；新进程在转发任何调用之前先经 onStart 交给调用方
 *   （媒体库在这里给订阅窗口重新接事件通道）。
 * - ready：子进程报 ready 时回调 onReady，带上 fork → ready 的耗时。调用不等 ready，消息由
 *   utilityProcess 排队。
 * - 调用表：按 id 配对请求与结果；子进程崩溃时挂起的调用全部失败，下一次调用再重启。
 * - 关停：发关停消息，stopTimeoutMs 内没退出就 kill；关停中来的调用等旧进程退完再 fork，
 *   不会两个同类进程同时在跑。关停时还挂着的调用失败。
 * - 空闲退出：idleMs > 0 时，没有挂起的调用、子进程也没报忙（setBusy）时，最后一次调用结束
 *   idleMs 后自动关停。
 *
 * 线协议由两端各自决定：宿主只通过 encodeCall / decodeReply / isReady 认识调用与结果，
 * 其余消息原样交给 onMessage。
 */

/** 子进程句柄的最小形状（Electron UtilityProcess 的子集）。 */
export interface UtilityChild<In, Out> {
  postMessage(message: In, transfer?: unknown[]): void
  on(event: 'message', listener: (message: Out) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  kill(): boolean
}

/** 子进程回来的一次调用结果。 */
export type UtilityReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; message: string; code?: string }

/** 调用失败：子进程报错（code 由子进程给）、崩溃或关停（code 为 unavailable）。 */
export class UtilityCallError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message)
    this.name = 'UtilityCallError'
  }
}

/** 默认关停多久没退出就 kill。 */
export const UTILITY_STOP_TIMEOUT_MS = 5_000

/** 宿主选项。In / Out 是两个方向的消息类型，C 是一次调用的载荷。 */
export interface UtilityHostOptions<In, Out, C> {
  /** 进程的中文名，用在错误消息里（如「后台引擎」） */
  name: string
  fork(): UtilityChild<In, Out>
  /** 把一次调用编码成发给子进程的消息 */
  encodeCall(id: number, call: C): In
  /** 从子进程消息里认出调用结果；不是结果时返回 undefined */
  decodeReply(message: Out): UtilityReply | undefined
  /** 认出 ready 消息；不给则不跟踪 ready */
  isReady?(message: Out): boolean
  /** 让子进程收尾退出的消息 */
  shutdown: In
  /** 调用结果与 ready 之外的消息；关停中的旧进程发来的也会到这里，child 用来区分 */
  onMessage?(message: Out, child: UtilityChild<In, Out>): void
  /** 新进程 fork 之后、转发任何调用之前 */
  onStart?(child: UtilityChild<In, Out>): void
  /** 子进程报 ready；elapsedMs 为 fork → ready 的耗时 */
  onReady?(elapsedMs: number): void
  /** 空闲多久自动关停；不给或 0 表示不空闲退出 */
  idleMs?: number
  /** 关停超时，默认 UTILITY_STOP_TIMEOUT_MS */
  stopTimeoutMs?: number
  /** 时钟（测 ready 耗时），默认 Date.now */
  now?(): number
}

/** 一个 utilityProcess 的宿主。 */
export class UtilityHost<In, Out, C> {
  private child: UtilityChild<In, Out> | undefined
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  private nextId = 1
  /** 子进程报告的忙碌状态（有调用之外的后台工作） */
  private busy = false
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  /** 正在关停的旧进程：退出（或被 kill）后 resolve */
  private stopping: Promise<void> | undefined

  constructor(private readonly opts: UtilityHostOptions<In, Out, C>) {}

  /** 子进程是否在运行（不含正在关停的旧进程） */
  get running(): boolean {
    return this.child !== undefined
  }

  /** 当前子进程（不含正在关停的旧进程） */
  get current(): UtilityChild<In, Out> | undefined {
    return this.child
  }

  /** 确保子进程在运行；关停中则等旧进程退完再 fork。 */
  start(): void {
    if (this.stopping) void this.stopping.then(() => this.ensure())
    else this.ensure()
  }

  private ensure(): UtilityChild<In, Out> {
    if (this.child) return this.child
    const now = this.opts.now ?? Date.now
    const forkedAt = now()
    const child = this.opts.fork()
    child.on('message', message => {
      const reply = this.opts.decodeReply(message)
      if (reply) return this.settle(reply)
      if (this.opts.isReady?.(message)) {
        if (this.child === child) this.opts.onReady?.(now() - forkedAt)
        return
      }
      this.opts.onMessage?.(message, child)
    })
    child.on('exit', code => {
      if (this.child !== child) return // 关停中的旧进程：由 stop() 收尾
      this.child = undefined
      this.busy = false
      clearTimeout(this.idleTimer)
      this.failPending(`${this.opts.name}已退出（code ${code}）`)
    })
    this.child = child
    this.opts.onStart?.(child)
    return child
  }

  private failPending(reason: string): void {
    const error = new UtilityCallError(reason, 'unavailable')
    for (const { reject } of this.pending.values()) reject(error)
    this.pending.clear()
  }

  private settle(reply: UtilityReply): void {
    const settle = this.pending.get(reply.id)
    if (!settle) return
    this.pending.delete(reply.id)
    if (reply.ok) settle.resolve(reply.value)
    else settle.reject(new UtilityCallError(reply.message, reply.code))
    this.armIdle()
  }

  /** 子进程报告忙碌状态；只认当前子进程，关停中的旧进程发来的忽略。 */
  setBusy(child: UtilityChild<In, Out>, busy: boolean): void {
    if (this.child !== child) return
    this.busy = busy
    this.armIdle()
  }

  /** 满足空闲条件时（重新）开始计时；不满足时取消计时。 */
  private armIdle(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    const idleMs = this.opts.idleMs
    if (!idleMs || !this.child || this.busy || this.pending.size) return
    this.idleTimer = setTimeout(() => void this.stop(), idleMs)
  }

  /** 转发一次调用。子进程关停中时等它退完再拉起新的。 */
  call(payload: C): Promise<unknown> {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    const send = (): Promise<unknown> => {
      const child = this.ensure()
      const id = this.nextId++
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        child.postMessage(this.opts.encodeCall(id, payload))
      })
    }
    return this.stopping ? this.stopping.then(send) : send()
  }

  /** 让当前子进程收尾退出（空闲到点或应用退出）：先发关停消息，超时 kill。 */
  stop(): Promise<void> {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    const child = this.child
    if (!child) return this.stopping ?? Promise.resolve()
    this.child = undefined
    this.busy = false
    const stopping = new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        child.kill()
        resolve()
      }, this.opts.stopTimeoutMs ?? UTILITY_STOP_TIMEOUT_MS)
      child.on('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.postMessage(this.opts.shutdown)
    }).finally(() => {
      // 新进程等 stopping 结束才 fork，这时还挂着的调用都属于旧进程
      this.failPending(`${this.opts.name}已关停`)
      if (this.stopping === stopping) this.stopping = undefined
    })
    this.stopping = stopping
    return stopping
  }
}
