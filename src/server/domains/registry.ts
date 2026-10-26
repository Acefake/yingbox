/**
 * 服务端的契约域登记表：模块宿主的 implement / emit 落在这里，HTTP 路由（routes.ts）按域名 + 方法名查表。
 *
 * - 参数先经契约的 parse 在边界解析，不合法时返回失败结果，处理函数不会被调用（与桌面端 rpc/index.ts 同一规则）；
 * - 只服务异步调用；同步调用（sendSync）是桌面端首屏专用，服务端不登记；
 * - 事件推给所有订阅者（每个 SSE 连接一个），订阅者自己处理序列化与断线。
 */
import {
  ContractError,
  type Domain,
  type PayloadOf,
  channelOf,
} from '../../shared/contract/define'
import type {
  DomainEventMessage,
  DomainRpcReply,
} from '../../shared/contract/http-wire'
import type { DomainHandlers } from '../../main/module-host'

type AnyHandler = (ctx: unknown, ...args: unknown[]) => unknown

/** 一个已登记的方法 */
interface Entry {
  parse(raw: readonly unknown[]): unknown[]
  handler: AnyHandler
}

/** 登记表 */
export class DomainRegistry {
  private readonly entries = new Map<string, Entry>()
  private readonly domains = new Set<string>()
  private readonly listeners = new Set<(message: DomainEventMessage) => void>()

  /** 登记一个域（同名域只能登记一次，免得两份定时器 / 状态） */
  implement<D extends Domain>(domain: D, handlers: DomainHandlers<D>): void {
    if (this.domains.has(domain.name))
      throw new Error(`[domains] ${domain.name} 已登记过`)
    const table = handlers as unknown as Record<string, AnyHandler>
    for (const [key, def] of Object.entries(domain.calls)) {
      if (def.kind !== 'call') continue
      if (typeof table[key] !== 'function')
        throw new Error(`[domains] ${channelOf(domain.name, key)} 缺少实现`)
      this.entries.set(channelOf(domain.name, key), {
        parse: raw => def.parse(raw) as unknown[],
        handler: table[key],
      })
    }
    this.domains.add(domain.name)
  }

  /** 已登记的域名 */
  names(): string[] {
    return [...this.domains]
  }

  /** 调用一个方法；未登记、参数不合法、处理函数抛错都转成失败结果 */
  async invoke(
    domain: string,
    method: string,
    args: unknown
  ): Promise<DomainRpcReply> {
    const channel = channelOf(domain, method)
    const entry = this.entries.get(channel)
    if (!entry)
      return {
        ok: false,
        error: this.domains.has(domain)
          ? `未知方法：${channel}`
          : `片库服务没有启用 ${domain}`,
      }
    if (!Array.isArray(args))
      return { ok: false, error: `[${channel}] 参数应为数组` }
    let parsed: unknown[]
    try {
      parsed = entry.parse(args)
    } catch (error) {
      if (error instanceof ContractError)
        return { ok: false, error: `[${channel}] ${error.message}` }
      throw error
    }
    try {
      const value = await entry.handler(undefined, ...parsed)
      return { ok: true, value: value === undefined ? null : value }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** 推送事件 */
  emit<D extends Domain, K extends keyof D['events'] & string>(
    domain: D,
    event: K,
    payload: PayloadOf<D['events'][K]>
  ): void {
    const message: DomainEventMessage = {
      domain: domain.name,
      event,
      payload: payload === undefined ? null : payload,
    }
    for (const listener of this.listeners) listener(message)
  }

  /** 订阅全部事件；返回退订函数 */
  subscribe(listener: (message: DomainEventMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
