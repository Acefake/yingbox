/**
 * 引擎侧的契约实现器：与主进程 main/rpc 的 implement 同构，handler 类型由契约推导。
 *
 * 入参已在主进程 IPC 边界解析过，这里不再校验。传输（parentPort）以参数注入，便于单测。
 */
import {
  type ArgsOf,
  type Domain,
  type PayloadOf,
  type ResultOf,
  channelOf,
} from '../shared/contract/define'
import type { FromEngine, HostMethods, ToEngine } from './protocol'

/** 引擎与主进程之间的端口（parentPort 的最小子集）。 */
export interface EnginePort {
  postMessage(message: FromEngine): void
  on(event: 'message', listener: (e: { data: ToEngine }) => void): void
}

/** 引擎内 handler 的上下文。 */
export interface EngineContext {
  /** 推送契约事件（经主进程广播给所有窗口） */
  emit<D extends Domain, K extends keyof D['events'] & string>(
    domain: D,
    event: K,
    payload: PayloadOf<D['events'][K]>
  ): void
  /** 报告调用之外的后台工作（如下载队列）是否在进行；忙时主进程不会空闲退出引擎 */
  busy(busy: boolean): void
  /** 请主进程代办 */
  host<M extends keyof HostMethods>(
    method: M,
    ...args: Parameters<HostMethods[M]>
  ): Promise<ReturnType<HostMethods[M]>>
}

/** 一个域在引擎里的全部实现：键与契约一一对应。 */
export type EngineHandlers<D extends Domain> = {
  [K in keyof D['calls']]: (
    ctx: EngineContext,
    ...args: ArgsOf<D['calls'][K]>
  ) => ResultOf<D['calls'][K]> | Promise<ResultOf<D['calls'][K]>>
}

type AnyHandler = (ctx: EngineContext, ...args: unknown[]) => unknown

/** 引擎 RPC 服务。 */
export interface EngineServer {
  /** 注册一个域；漏实现或多实现在注册时抛错。 */
  implement<D extends Domain>(domain: D, handlers: EngineHandlers<D>): void
  /** 收到 shutdown 时调用 */
  onShutdown(listener: () => void): void
  /** 共享上下文：调用之外（如后台队列）推事件、请主进程代办时使用 */
  readonly context: EngineContext
}

/** 在端口上启动引擎 RPC。 */
export function serveEngine(port: EnginePort): EngineServer {
  const table = new Map<string, AnyHandler>()
  const pendingHost = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  const shutdownListeners: Array<() => void> = []
  let nextHostId = 1

  const ctx: EngineContext = {
    emit(domain, event, payload) {
      port.postMessage({
        kind: 'event',
        channel: channelOf(domain.name, event),
        payload,
      })
    },
    busy(busy) {
      port.postMessage({ kind: 'busy', busy })
    },
    host(method, ...args) {
      const id = nextHostId++
      return new Promise((resolve, reject) => {
        pendingHost.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
        })
        port.postMessage({ kind: 'host', id, method, args })
      })
    },
  }

  port.on('message', ({ data }) => {
    if (data.kind === 'shutdown') {
      for (const listener of shutdownListeners) listener()
      return
    }
    if (data.kind === 'hostResult') {
      const pending = pendingHost.get(data.id)
      if (!pending) return
      pendingHost.delete(data.id)
      if (data.ok) pending.resolve(data.value)
      else pending.reject(new Error(data.error))
      return
    }
    const handler = table.get(data.channel)
    const reply = (ok: boolean, value?: unknown, error?: string): void =>
      port.postMessage({ kind: 'result', id: data.id, ok, value, error })
    if (!handler) {
      reply(false, undefined, `[engine] 未实现 ${data.channel}`)
      return
    }
    Promise.resolve()
      .then(() => handler(ctx, ...data.args))
      .then(
        value => reply(true, value),
        (error: unknown) =>
          reply(
            false,
            undefined,
            error instanceof Error ? error.message : String(error)
          )
      )
  })

  return {
    implement(domain, handlers) {
      const impl = handlers as unknown as Record<string, AnyHandler>
      for (const key of Object.keys(impl)) {
        if (!(key in domain.calls))
          throw new Error(`[engine] ${channelOf(domain.name, key)} 不在契约里`)
      }
      for (const key of Object.keys(domain.calls)) {
        if (typeof impl[key] !== 'function')
          throw new Error(`[engine] ${channelOf(domain.name, key)} 缺少实现`)
        table.set(channelOf(domain.name, key), impl[key])
      }
    },
    onShutdown(listener) {
      shutdownListeners.push(listener)
    },
    context: ctx,
  }
}
