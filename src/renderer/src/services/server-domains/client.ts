/**
 * 网页端的契约域 transport：给没有 preload 的网页端造出与 window.api.<域> 同形的对象，经独立片库服务调用。
 *
 * - 调用：`api.search(keyword)` → POST /api/domains/pan115/search { args: [keyword] } → DomainRpcReply，
 *   成功返回 value，失败（含服务端处理函数抛错）抛 Error(人话)，与 IPC invoke 被 reject 时一致；
 * - 事件：`api.onChanged(cb)` 登记回调，第一个订阅时才打开共用的 EventSource；`api.offChanged()` 去掉该事件的全部回调
 *   （与 preload 的 off<Key> 语义相同）；
 * - 依赖以参数注入（请求函数、EventSource 构造），单测用假的实现；index.ts 接到真实的同源请求。
 */
import {
  DOMAIN_HTTP,
  type DomainEventMessage,
  type DomainRpcReply,
} from '../../../../shared/contract/http-wire'

/** 请求函数（同源 fetch 的子集） */
export type DomainRequest = (
  path: string,
  init: RequestInit
) => Promise<Response>

/** 打开的事件流 */
export interface DomainEventStream {
  close(): void
}

/** 依赖 */
export interface DomainClientDeps {
  request: DomainRequest
  openEvents(url: string, onData: (data: string) => void): DomainEventStream
}

/** 一个域的客户端：调用方法 + on / off 事件方法（按名字动态分派） */
export type DomainClient = Record<string, (...args: unknown[]) => unknown>

/** 事件方法名 → 事件键：onChanged → changed；不是 on / off 开头时为 null */
export function eventKeyOf(name: string, prefix: 'on' | 'off'): string | null {
  if (!name.startsWith(prefix) || name.length <= prefix.length) return null
  const rest = name.slice(prefix.length)
  if (rest.charAt(0) !== rest.charAt(0).toUpperCase()) return null
  return rest.charAt(0).toLowerCase() + rest.slice(1)
}

/** 读调用结果；不是 DomainRpcReply 时按 HTTP 状态给人话 */
async function readReply(response: Response): Promise<unknown> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(
      response.ok
        ? '片库服务返回的不是 JSON，可能没有部署片库服务'
        : `片库服务出错（HTTP ${response.status}）`
    )
  }
  const reply = body as Partial<DomainRpcReply> & { error?: unknown }
  if (response.status === 401) throw new Error('需要登录片库服务')
  if (reply?.ok === true)
    return (reply as { value: unknown }).value ?? undefined
  if (typeof reply?.error === 'string') throw new Error(reply.error)
  throw new Error(`片库服务出错（HTTP ${response.status}）`)
}

/** 创建共用一个事件流的域客户端工厂 */
export function createDomainClients(deps: DomainClientDeps): {
  domain(name: string): DomainClient
} {
  /** 「域:事件」→ 回调 */
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  let stream: DomainEventStream | null = null

  function dispatch(data: string): void {
    let message: DomainEventMessage
    try {
      message = JSON.parse(data) as DomainEventMessage
    } catch {
      return
    }
    const set = listeners.get(`${message.domain}:${message.event}`)
    for (const cb of set ?? []) cb(message.payload ?? undefined)
  }

  function on(channel: string, cb: (payload: unknown) => void): void {
    const set = listeners.get(channel) ?? new Set()
    set.add(cb)
    listeners.set(channel, set)
    stream ??= deps.openEvents(DOMAIN_HTTP.events, dispatch)
  }

  function off(channel: string): void {
    listeners.delete(channel)
    if (!listeners.size && stream) {
      stream.close()
      stream = null
    }
  }

  function call(
    domain: string,
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    return deps
      .request(DOMAIN_HTTP.rpc(domain, method), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 参数先过一遍 JSON，reactive 代理只留下纯数据
        body: JSON.stringify({ args }),
      })
      .then(readReply)
  }

  const cache = new Map<string, DomainClient>()
  return {
    domain(name) {
      const cached = cache.get(name)
      if (cached) return cached
      const client = new Proxy({} as DomainClient, {
        get(_, key) {
          // 不是方法名的探测（then、toJSON、Vue 的 __v_* 标记）一律没有
          if (
            typeof key !== 'string' ||
            key === 'then' ||
            key === 'toJSON' ||
            key.startsWith('__')
          )
            return undefined
          const onKey = eventKeyOf(key, 'on')
          if (onKey)
            return (cb: (payload: unknown) => void) =>
              on(`${name}:${onKey}`, cb)
          const offKey = eventKeyOf(key, 'off')
          if (offKey) return () => off(`${name}:${offKey}`)
          return (...args: unknown[]) => call(name, key, args)
        },
      })
      cache.set(name, client)
      return client
    },
  }
}
