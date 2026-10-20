/**
 * 主进程侧的引擎宿主：按需 fork 引擎（utilityProcess），转发契约调用，广播引擎事件，
 * 代办引擎请求的主进程能力（浏览器代抓）。
 *
 * 主进程在这里只做机械转发，不做任何解析或网络请求。引擎崩溃时挂起的调用失败，
 * 下一次调用自动重启。
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

/** 宿主依赖：fork 子进程、广播事件、实现主进程能力。 */
export interface EngineHostDeps {
  fork: () => EngineChild
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

  constructor(private readonly deps: EngineHostDeps) {}

  /** 引擎是否在运行 */
  get running(): boolean {
    return this.child !== undefined
  }

  private ensure(): EngineChild {
    if (this.child) return this.child
    const child = this.deps.fork()
    child.on('message', message => this.onMessage(child, message))
    child.on('exit', code => {
      if (this.child === child) this.child = undefined
      const error = new Error(`后台引擎已退出（code ${code}）`)
      for (const { reject } of this.pending.values()) reject(error)
      this.pending.clear()
    })
    this.child = child
    return child
  }

  private onMessage(child: EngineChild, message: FromEngine): void {
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
  }

  /** 转发一次调用（参数已在 IPC 边界解析）。 */
  invoke(channel: string, args: unknown[]): Promise<unknown> {
    const child = this.ensure()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      child.postMessage({ kind: 'call', id, channel, args })
    })
  }

  /** 通知引擎收尾并退出。 */
  shutdown(): void {
    this.child?.postMessage({ kind: 'shutdown' })
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
