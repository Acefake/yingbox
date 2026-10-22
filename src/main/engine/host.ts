/**
 * 主进程侧的引擎宿主：按需 fork 引擎（utilityProcess），转发契约调用，广播引擎事件，
 * 代办引擎请求的主进程能力（浏览器代抓）。
 *
 * 主进程在这里只做机械转发，不做任何解析或网络请求。引擎崩溃时挂起的调用失败，
 * 下一次调用自动重启。
 *
 * 空闲退出：没有挂起的调用、引擎也没报告忙（有下载在跑或排队）时，最后一次调用结束
 * idleMs 后让引擎收尾退出，省下整个进程的内存；下次调用等旧进程退干净再重新 fork。
 * 关停（空闲或应用退出）超过 stopTimeoutMs 还没退出就直接 kill。
 */
import type { CallContext, Handlers } from '../rpc'
import { type Domain, channelOf } from '../../shared/contract/define'
import type { FromEngine, HostMethods, ToEngine } from '../../engine/protocol'

/** 子进程句柄的最小形状（Electron UtilityProcess 的子集）。 */
export interface EngineChild {
  postMessage(message: ToEngine): void
  on(event: 'message', listener: (message: FromEngine) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  kill(): boolean
}

/** 默认空闲多久退出引擎。 */
export const ENGINE_IDLE_MS = 5 * 60_000
/** 默认关停多久没退出就 kill。 */
export const ENGINE_STOP_TIMEOUT_MS = 5_000

/** 宿主依赖：fork 子进程、广播事件、实现主进程能力。 */
export interface EngineHostDeps {
  fork: () => EngineChild
  /** 空闲退出的等待时长，默认 ENGINE_IDLE_MS；0 表示不空闲退出 */
  idleMs?: number
  /** 关停超时，默认 ENGINE_STOP_TIMEOUT_MS */
  stopTimeoutMs?: number
  broadcast: (channel: string, payload: unknown) => void
  hostMethods: {
    [M in keyof HostMethods]: (
      ...args: Parameters<HostMethods[M]>
    ) => Promise<ReturnType<HostMethods[M]>>
  }
}

/** 引擎宿主。 */
export class EngineHost {
  private child: EngineChild | undefined
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  private nextId = 1
  /** 引擎报告的忙碌状态（有下载在跑或排队） */
  private busy = false
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  /** 正在关停的旧进程：退出（或被 kill）后 resolve */
  private stopping: Promise<void> | undefined

  constructor(private readonly deps: EngineHostDeps) {}

  /** 引擎是否在运行（不含正在关停的旧进程） */
  get running(): boolean {
    return this.child !== undefined
  }

  private ensure(): EngineChild {
    if (this.child) return this.child
    const child = this.deps.fork()
    child.on('message', message => this.onMessage(child, message))
    child.on('exit', code => {
      if (this.child !== child) return // 关停中的旧进程：由 stop() 收尾
      this.child = undefined
      this.busy = false
      clearTimeout(this.idleTimer)
      this.failPending(`后台引擎已退出（code ${code}）`)
    })
    this.child = child
    return child
  }

  private failPending(reason: string): void {
    const error = new Error(reason)
    for (const { reject } of this.pending.values()) reject(error)
    this.pending.clear()
  }

  /** 满足空闲条件时（重新）开始计时；不满足时取消计时。 */
  private armIdle(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    const idleMs = this.deps.idleMs ?? ENGINE_IDLE_MS
    if (!idleMs || !this.child || this.busy || this.pending.size) return
    this.idleTimer = setTimeout(() => void this.stop(), idleMs)
  }

  /**
   * 让当前引擎收尾退出：先发 shutdown，超时 kill。调用期间新来的调用等它退完再 fork 新进程，
   * 不会两个引擎同时读写队列文件。
   */
  private stop(): Promise<void> {
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
      }, this.deps.stopTimeoutMs ?? ENGINE_STOP_TIMEOUT_MS)
      child.on('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.postMessage({ kind: 'shutdown' })
    }).finally(() => {
      // 应用退出时可能还有挂起的调用：新进程等 stopping 结束才 fork，所以这些都属于旧进程
      this.failPending('后台引擎已关停')
      if (this.stopping === stopping) this.stopping = undefined
    })
    this.stopping = stopping
    return stopping
  }

  private onMessage(child: EngineChild, message: FromEngine): void {
    if (message.kind === 'busy') {
      if (this.child !== child) return
      this.busy = message.busy
      this.armIdle()
      return
    }
    if (message.kind === 'event') {
      this.deps.broadcast(message.channel, message.payload)
      return
    }
    if (message.kind === 'host') {
      const method = this.deps.hostMethods[message.method] as (
        ...args: unknown[]
      ) => Promise<unknown>
      const reply = (ok: boolean, value?: unknown, error?: string): void =>
        child.postMessage({
          kind: 'hostResult',
          id: message.id,
          ok,
          value,
          error,
        })
      if (!method) {
        reply(false, undefined, `未知主进程能力：${String(message.method)}`)
        return
      }
      method(...message.args).then(
        value => reply(true, value),
        (error: unknown) => reply(false, undefined, String(error))
      )
      return
    }
    const settle = this.pending.get(message.id)
    if (!settle) return
    this.pending.delete(message.id)
    if (message.ok) settle.resolve(message.value)
    else settle.reject(new Error(message.error))
    this.armIdle()
  }

  /** 转发一次调用（参数已在 IPC 边界解析）。引擎空闲退出中时等它退完再拉起新的。 */
  invoke(channel: string, args: unknown[]): Promise<unknown> {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    const send = (): Promise<unknown> => {
      const child = this.ensure()
      const id = this.nextId++
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        child.postMessage({ kind: 'call', id, channel, args })
      })
    }
    return this.stopping ? this.stopping.then(send) : send()
  }

  /** 通知引擎收尾并退出（应用退出时）；超时 kill。 */
  shutdown(): Promise<void> {
    return this.stop()
  }
}

/**
 * 为一个由引擎实现的域生成主进程 handlers：每个调用原样转发给引擎。
 * 配合 main/rpc 的 implement 使用，入参解析仍在主进程 IPC 边界完成。
 */
export function forwardTo<D extends Domain>(
  host: EngineHost,
  domain: D
): Handlers<D> {
  const handlers: Record<
    string,
    (ctx: CallContext, ...args: unknown[]) => unknown
  > = {}
  for (const key of Object.keys(domain.calls)) {
    const channel = channelOf(domain.name, key)
    handlers[key] = (_ctx, ...args) => host.invoke(channel, args)
  }
  return handlers as Handlers<D>
}
