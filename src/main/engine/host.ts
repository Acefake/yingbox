/**
 * 主进程侧的引擎宿主：按需 fork 引擎（utilityProcess），转发契约调用，广播引擎事件，
 * 代办引擎请求的主进程能力（浏览器代抓）。
 *
 * 主进程在这里只做机械转发，不做任何解析或网络请求。按需 fork、崩溃后下次调用重启、
 * 关停超时 kill、空闲退出都由 UtilityHost（main/utility/host.ts）负责。
 *
 * 空闲退出：没有挂起的调用、引擎也没报告忙（有下载在跑或排队）时，最后一次调用结束
 * idleMs（默认 5 分钟）后让引擎收尾退出，省下整个进程的内存；下次调用自动拉起。
 */
import type { CallContext, Handlers } from '../rpc'
import { type Domain, channelOf } from '../../shared/contract/define'
import type { HostMethods } from '../../engine/protocol'
import {
  UTILITY_STOP_TIMEOUT_MS,
  type UtilityChild,
  UtilityHost,
} from '../utility/host'

/** 子进程句柄（Electron UtilityProcess 的子集）。 */
export type EngineChild = UtilityChild

/** 默认空闲多久退出引擎。 */
export const ENGINE_IDLE_MS = 5 * 60_000
/** 默认关停多久没退出就 kill。 */
export const ENGINE_STOP_TIMEOUT_MS = UTILITY_STOP_TIMEOUT_MS

/** 宿主依赖：fork 子进程、广播事件、实现主进程能力。 */
export interface EngineHostDeps {
  fork: () => EngineChild
  /** 空闲退出的等待时长，默认 ENGINE_IDLE_MS；0 表示不空闲退出 */
  idleMs?: number
  /** 关停超时，默认 ENGINE_STOP_TIMEOUT_MS */
  stopTimeoutMs?: number
  broadcast: (channel: string, payload: unknown) => void
  /** 引擎就绪（模块加载完）；elapsedMs 为 fork → ready 的耗时 */
  onReady?: (elapsedMs: number) => void
  hostMethods: {
    [M in keyof HostMethods]: (
      ...args: Parameters<HostMethods[M]>
    ) => Promise<ReturnType<HostMethods[M]>>
  }
}

/** 引擎宿主：生命周期与线协议交给 UtilityHost，这里只接引擎的事件广播与主进程能力表。 */
export class EngineHost {
  private readonly utility: UtilityHost

  constructor(deps: EngineHostDeps) {
    this.utility = new UtilityHost({
      name: '后台引擎',
      fork: deps.fork,
      idleMs: deps.idleMs ?? ENGINE_IDLE_MS,
      stopTimeoutMs: deps.stopTimeoutMs,
      onEvent: deps.broadcast,
      onReady: deps.onReady,
      host: deps.hostMethods,
    })
  }

  /** 引擎是否在运行（不含正在关停的旧进程） */
  get running(): boolean {
    return this.utility.running
  }

  /** 转发一次调用（参数已在 IPC 边界解析）。引擎空闲退出中时等它退完再拉起新的。 */
  invoke(channel: string, args: unknown[]): Promise<unknown> {
    return this.utility.call(channel, args)
  }

  /** 通知引擎收尾并退出（应用退出时）；超时 kill。 */
  shutdown(): Promise<void> {
    return this.utility.stop()
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
