import { type StreamHeaders, streamHeaderQuery } from './net/stream-headers'

/**
 * 独立服务（src/server）上的在线引擎接口：网页端经 HTTP 调用与桌面端 IPC 相同的契约。
 *
 * - 调用：POST {@link ENGINE_HTTP.rpc} `{ channel: 'online:vod', args: [...] }` → {@link EngineRpcResult}；
 *   通道名、参数元组、返回值与 window.api.<域>.<方法> 一字不差，参数在服务端用契约的 parse 校验。
 * - 事件：GET {@link ENGINE_HTTP.events}（SSE），每条 data 是 {@link EngineEventMessage}。
 * - 播放代理：GET {@link ENGINE_HTTP.stream}?src=<地址>[&ua=&referer=]，透传 Range、按源注入 Referer（线路自带的头优先，
 *   见 net/stream-headers），m3u8 改写成经代理取分片（分片带上同样的头参数）。
 * 只开放 {@link ENGINE_HTTP_DOMAINS} 里的域。纯类型与常量，两端共用。
 */

/** 路径。 */
export const ENGINE_HTTP = {
  rpc: '/api/engine/rpc',
  events: '/api/engine/events',
  stream: '/api/stream',
} as const

/** 经 HTTP 开放的引擎域（契约见 shared/contract/online、av、download）；服务端的开放范围只从这里取。 */
export const ENGINE_HTTP_DOMAINS = ['online', 'av', 'download'] as const

/** 开放的域名。 */
export type EngineHttpDomain = (typeof ENGINE_HTTP_DOMAINS)[number]

/**
 * 一次调用。JSON 表达不了 undefined（数组里的 undefined 会变成 null），而 IPC 的结构化克隆会原样保留它，
 * 契约的 parse 也区分「没传」和 null：所以值为 undefined 的参数下标单独放在 undefinedAt，服务端还原后再解析。
 */
export interface EngineRpcRequest {
  channel: string
  args: unknown[]
  undefinedAt?: number[]
}

/** 编码一次调用：记下值为 undefined 的顶层参数下标（没有时不带 undefinedAt）。 */
export function encodeRpcRequest(
  channel: string,
  args: readonly unknown[]
): EngineRpcRequest {
  const undefinedAt = args.flatMap((arg, index) =>
    arg === undefined ? [index] : []
  )
  return {
    channel,
    args: args.map(arg => (arg === undefined ? null : arg)),
    ...(undefinedAt.length ? { undefinedAt } : {}),
  }
}

/**
 * 服务端还原 undefined 参数；undefinedAt 不是参数范围内的整数下标数组时返回 null（按参数不合法处理）。
 * args 不是数组时原样返回，交给调用方报错。
 */
export function restoreUndefinedArgs(
  args: unknown,
  undefinedAt: unknown
): unknown {
  if (undefinedAt === undefined || !Array.isArray(args)) return args
  if (
    !Array.isArray(undefinedAt) ||
    !undefinedAt.every(
      index => Number.isInteger(index) && index >= 0 && index < args.length
    )
  )
    return null
  const restored = [...args]
  for (const index of undefinedAt as number[]) restored[index] = undefined
  return restored
}

/** 调用结果；失败时 code 为 invalid-params（参数不合契约）、unavailable（引擎不可用）或引擎给的码。 */
export type EngineRpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code?: string; message: string } }

/** 一条事件。 */
export interface EngineEventMessage {
  channel: string
  payload: unknown
}

/** 远程媒体地址经服务代理的地址（同源相对路径，Cookie 鉴权自动带上）；headers 是线路自带的请求头。 */
export function streamProxyPath(
  source: string,
  headers?: StreamHeaders
): string {
  return `${ENGINE_HTTP.stream}?src=${encodeURIComponent(source)}${streamHeaderQuery(headers)}`
}
