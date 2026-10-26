/**
 * 网页端的引擎 transport：按契约生成与 window.api.<域> 同形状的对象，调用走 HTTP RPC，事件走一条 SSE。
 * 界面代码拿到的是同一个 DomainApi，不区分 IPC 还是 HTTP（与片库的 http-bridge 同一个思路）。
 *
 * - 调用：POST /api/engine/rpc { channel, args, undefinedAt? } → EngineRpcResult（undefined 参数单独标出，
 *   服务端还原后与 IPC 收到的一致）；失败 reject，消息与桌面端一样给人看；
 * - 事件：on<Key>(cb) 订阅、off<Key>() 退订该事件的全部回调（与 preload 一致）；一个页面只开一条 SSE，
 *   没有订阅时关掉；
 * - 404：服务没开在线板块（YINGBOX_ONLINE=off）。
 * 依赖以参数注入（请求函数、EventSource 构造），单测用假的实现。
 */
import {
  type Domain,
  type DomainApi,
  channelOf,
  listenerNames,
} from '../../../../shared/contract/define'
import {
  ENGINE_HTTP,
  type EngineEventMessage,
  type EngineRpcResult,
  encodeRpcRequest,
} from '../../../../shared/engine-http'

/** 请求函数（同源 fetch 的子集）。 */
export type EngineRequest = (
  path: string,
  init: RequestInit
) => Promise<Response>

/** 打开的事件流。 */
export interface EngineEventStream {
  close(): void
}

/** 依赖。 */
export interface EngineBridgeDeps {
  request: EngineRequest
  /**
   * 打开事件流，每条消息的 data 交给 onData；事件流自己关掉（不再重连）时调用 onClosed，
   * bridge 据此丢掉它，之后的订阅或 resume() 会重新打开。
   */
  openEvents: (
    url: string,
    onData: (data: string) => void,
    onClosed: () => void
  ) => EngineEventStream
}

/** 引擎调用失败（code 同服务端：invalid-params / unavailable / engine / http）。 */
export class EngineCallError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'EngineCallError'
  }
}

/** HTTP 状态 → 给人看的原因。 */
function transportMessage(status: number): string {
  if (status === 0) return '无法连接片库服务'
  if (status === 401) return '需要登录片库服务'
  if (status === 404) return '片库服务没有开启在线板块（YINGBOX_ONLINE）'
  return `片库服务出错（HTTP ${status}）`
}

/** 一组域共用的 transport：一个调用函数 + 一条事件流。 */
export interface EngineBridge {
  call(channel: string, args: unknown[]): Promise<unknown>
  api<D extends Domain>(domain: D): DomainApi<D>
  /** 还有订阅却没有事件流（之前自己关掉了）时重新打开；服务恢复在线时调用 */
  resume(): void
}

/** 创建 transport。 */
export function createEngineBridge(deps: EngineBridgeDeps): EngineBridge {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  let stream: EngineEventStream | null = null

  const dispatch = (data: string): void => {
    let event: EngineEventMessage
    try {
      event = JSON.parse(data) as EngineEventMessage
    } catch {
      return
    }
    for (const cb of listeners.get(event.channel) ?? []) cb(event.payload)
  }

  const hasListeners = (): boolean =>
    [...listeners.values()].some(set => set.size)

  const open = (): void => {
    if (stream) return
    const opened: EngineEventStream = deps.openEvents(
      ENGINE_HTTP.events,
      dispatch,
      () => {
        if (stream === opened) stream = null
      }
    )
    stream = opened
  }

  const resume = (): void => {
    if (hasListeners()) open()
  }

  const closeIfIdle = (): void => {
    if (stream && !hasListeners()) {
      stream.close()
      stream = null
    }
  }

  const call = async (channel: string, args: unknown[]): Promise<unknown> => {
    let response: Response
    try {
      response = await deps.request(ENGINE_HTTP.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(encodeRpcRequest(channel, args)),
      })
    } catch {
      throw new EngineCallError(transportMessage(0), 'http')
    }
    if (!response.ok)
      throw new EngineCallError(transportMessage(response.status), 'http')
    const result = (await response
      .json()
      .catch(() => null)) as EngineRpcResult | null
    if (!result || typeof result !== 'object' || !('ok' in result))
      throw new EngineCallError('片库服务返回的不是引擎结果', 'http')
    if (result.ok) return result.value
    throw new EngineCallError(
      result.error.message,
      result.error.code ?? 'engine'
    )
  }

  const api = <D extends Domain>(domain: D): DomainApi<D> => {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(domain.calls)) {
      const channel = channelOf(domain.name, key)
      out[key] = (...args: unknown[]): Promise<unknown> => call(channel, args)
    }
    for (const key of Object.keys(domain.events)) {
      const channel = channelOf(domain.name, key)
      const { on, off } = listenerNames(key)
      out[on] = (cb: (payload: unknown) => void): void => {
        const set = listeners.get(channel) ?? new Set()
        set.add(cb)
        listeners.set(channel, set)
        open()
      }
      out[off] = (): void => {
        listeners.delete(channel)
        closeIfIdle()
      }
    }
    return out as DomainApi<D>
  }

  return { call, api, resume }
}
