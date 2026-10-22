/**
 * utilityProcess 宿主：主进程里两个后台进程（在线引擎 yingbox-engine、媒体库引擎 yingbox-library）
 * 共用的生命周期与调用表。与 Electron 无关，fork 以参数注入，便于单测。
 *
 * - 按需启动：第一次调用（或 start()）才 fork；新进程在转发任何调用之前先经 onStart 交给调用方
 *   （媒体库在这里给订阅窗口重新接事件通道）。
 * - ready：子进程报 ready 时回调 onReady，带上 fork → ready 的耗时。调用不等 ready，消息由
 *   utilityProcess 排队。
 * - 调用表：按 id 配对请求与结果；子进程崩溃时挂起的调用全部失败，下一次调用再重启。
 * - 崩溃守卫（crash-guard.ts）：缺依赖或连续秒退时不再 fork，之后的调用直接带原因失败，
 *   避免启动即崩时每次调用都 fork 一个新进程（fork 风暴会拖死整机）。
 * - 关停：发关停消息，stopTimeoutMs 内没退出就 kill；关停中来的调用等旧进程退完再 fork，
 *   不会两个同类进程同时在跑。关停时还挂着的调用失败。
 * - 空闲退出：idleMs > 0 时，没有挂起的调用、子进程也没报忙（busy 消息）时，最后一次调用
 *   结束 idleMs 后自动关停。
 * - 事件交给 onEvent；代办请求（host）交给 host，结果回给发请求的那个子进程。
 *
 * 线协议见 shared/utility/protocol.ts，两种子进程共用；各自的方法表由调用方决定。
 */
import { CrashGuard } from './crash-guard'
import type {
  FromUtility,
  ToUtility,
  UtilityOutcome,
} from '../../shared/utility/protocol'

/** 子进程句柄的最小形状（Electron UtilityProcess 的子集）。 */
export interface UtilityChild {
  postMessage(message: ToUtility, transfer?: unknown[]): void
  on(event: 'message', listener: (message: FromUtility) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  kill(): boolean
  /** 子进程的 stderr（fork 时 stdio 第三项为 'pipe' 才有）：交给崩溃守卫认出缺依赖，再原样转到终端。 */
  stderr?: {
    on(event: 'data', listener: (chunk: Buffer | string) => void): void
  } | null
}

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

/** 宿主选项。 */
export interface UtilityHostOptions {
  /** 进程的中文名，用在错误消息里（如「后台引擎」） */
  name: string
  fork(): UtilityChild
  /** 新进程 fork 之后、转发任何调用之前 */
  onStart?(child: UtilityChild): void
  /** 子进程报 ready；elapsedMs 为 fork → ready 的耗时 */
  onReady?(elapsedMs: number): void
  /** 子进程推来的事件（关停中的旧进程发来的也算） */
  onEvent?(channel: string, payload: unknown): void
  /** 子进程能请主进程代办的事（方法名 → 实现）；不在表里的回「未知主进程能力」 */
  host?: Readonly<Record<string, (...args: never[]) => Promise<unknown>>>
  /** 空闲多久自动关停；不给或 0 表示不空闲退出 */
  idleMs?: number
  /** 关停超时，默认 UTILITY_STOP_TIMEOUT_MS */
  stopTimeoutMs?: number
  /** 时钟（测 ready 耗时、秒退判定），默认 Date.now */
  now?(): number
  /** stderr 的去处，默认写到主进程 stderr */
  writeStderr?(chunk: Buffer | string): void
  /** 守卫停止重启时（只调一次） */
  onBlocked?(reason: string): void
}

/** 一个 utilityProcess 的宿主。 */
export class UtilityHost {
  private child: UtilityChild | undefined
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

  private readonly now: () => number
  private readonly guard: CrashGuard
  private blockedReported = false

  constructor(private readonly opts: UtilityHostOptions) {
    this.now = opts.now ?? Date.now
    this.guard = new CrashGuard(opts.name, this.now)
  }

  /** 守卫已停止重启时的原因；能正常 fork 时 undefined。 */
  get blocked(): string | undefined {
    return this.guard.blocked()
  }

  /** 子进程是否在运行（不含正在关停的旧进程） */
  get running(): boolean {
    return this.child !== undefined
  }

  /** 当前子进程（不含正在关停的旧进程） */
  get current(): UtilityChild | undefined {
    return this.child
  }

  /** 确保子进程在运行；关停中则等旧进程退完再 fork。守卫停止重启时什么都不做。 */
  start(): void {
    const run = (): void => {
      if (!this.guard.blocked()) this.ensure()
    }
    if (this.stopping) void this.stopping.then(run)
    else run()
  }

  /** 拿到在跑的子进程，必要时 fork；守卫停止重启时抛 unavailable。 */
  private ensure(): UtilityChild {
    if (this.child) return this.child
    const blocked = this.guard.blocked()
    if (blocked) throw new UtilityCallError(blocked, 'unavailable')
    const forkedAt = this.now()
    const child = this.opts.fork()
    this.guard.started(forkedAt)
    const write =
      this.opts.writeStderr ??
      ((chunk: Buffer | string) => process.stderr.write(chunk))
    child.stderr?.on('data', chunk => {
      write(chunk)
      this.guard.observe(chunk.toString())
    })
    child.on('message', message => this.onMessage(child, message, forkedAt))
    child.on('exit', code => {
      if (this.child !== child) return // 关停中的旧进程：由 stop() 收尾
      this.child = undefined
      this.busy = false
      clearTimeout(this.idleTimer)
      this.guard.exited()
      const blocked = this.guard.blocked()
      if (blocked && !this.blockedReported) {
        this.blockedReported = true
        this.opts.onBlocked?.(blocked)
      }
      this.failPending(blocked ?? `${this.opts.name}已退出（code ${code}）`)
    })
    this.child = child
    this.opts.onStart?.(child)
    return child
  }

  private onMessage(
    child: UtilityChild,
    message: FromUtility,
    forkedAt: number
  ): void {
    switch (message.kind) {
      case 'result':
        return this.settle(message)
      case 'ready':
        if (this.child === child) this.opts.onReady?.(this.now() - forkedAt)
        return
      case 'busy':
        // 只认当前进程：关停中的旧进程发来的迟到消息不算到新进程头上
        if (this.child !== child) return
        this.busy = message.busy
        return this.armIdle()
      case 'event':
        return this.opts.onEvent?.(message.channel, message.payload)
      case 'host': {
        const reply = (outcome: UtilityOutcome): void =>
          child.postMessage({ kind: 'reply', id: message.id, ...outcome })
        const method = this.opts.host?.[message.method] as
          | ((...args: unknown[]) => Promise<unknown>)
          | undefined
        if (!method) {
          reply({
            ok: false,
            error: { message: `未知主进程能力：${message.method}` },
          })
          return
        }
        method(...message.args).then(
          value => reply({ ok: true, value }),
          (error: unknown) =>
            reply({ ok: false, error: { message: String(error) } })
        )
      }
    }
  }

  private failPending(reason: string): void {
    const error = new UtilityCallError(reason, 'unavailable')
    for (const { reject } of this.pending.values()) reject(error)
    this.pending.clear()
  }

  private settle(result: Extract<FromUtility, { kind: 'result' }>): void {
    const settle = this.pending.get(result.id)
    if (!settle) return
    this.pending.delete(result.id)
    if (result.ok) settle.resolve(result.value)
    else
      settle.reject(
        new UtilityCallError(result.error.message, result.error.code)
      )
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
  call(method: string, args: unknown[]): Promise<unknown> {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    const send = (): Promise<unknown> => {
      let child: UtilityChild
      try {
        child = this.ensure()
      } catch (error) {
        return Promise.reject(error)
      }
      const id = this.nextId++
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        child.postMessage({ kind: 'call', id, method, args })
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
      child.postMessage({ kind: 'shutdown' })
    }).finally(() => {
      // 新进程等 stopping 结束才 fork，这时还挂着的调用都属于旧进程
      this.failPending(`${this.opts.name}已关停`)
      if (this.stopping === stopping) this.stopping = undefined
    })
    this.stopping = stopping
    return stopping
  }
}
