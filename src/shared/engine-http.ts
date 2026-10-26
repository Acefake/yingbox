/**
 * 独立服务（src/server）上的在线引擎接口：网页端经 HTTP 调用与桌面端 IPC 相同的契约。
 *
 * - 调用：POST {@link ENGINE_HTTP.rpc} `{ channel: 'online:vod', args: [...] }` → {@link EngineRpcResult}；
 *   通道名、参数元组、返回值与 window.api.<域>.<方法> 一字不差，参数在服务端用契约的 parse 校验。
 * - 事件：GET {@link ENGINE_HTTP.events}（SSE），每条 data 是 {@link EngineEventMessage}。
 * - 播放代理：GET {@link ENGINE_HTTP.stream}?src=<地址>，透传 Range、按源注入 Referer，m3u8 改写成经代理取分片。
 * 只开放 {@link ENGINE_HTTP_DOMAINS} 里的域。纯类型与常量，两端共用。
 */

/** 路径。 */
export const ENGINE_HTTP = {
  rpc: '/api/engine/rpc',
  events: '/api/engine/events',
  stream: '/api/stream',
} as const

/** 经 HTTP 开放的引擎域（契约见 shared/contract/online、av、download）。 */
export const ENGINE_HTTP_DOMAINS = ['online', 'av', 'download'] as const

/** 一次调用。 */
export interface EngineRpcRequest {
  channel: string
  args: unknown[]
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

/** 远程媒体地址经服务代理的地址（同源相对路径，Cookie 鉴权自动带上）。 */
export function streamProxyPath(source: string): string {
  return `${ENGINE_HTTP.stream}?src=${encodeURIComponent(source)}`
}
