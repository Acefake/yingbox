/**
 * 契约域经独立服务（src/server）的 HTTP 线格式：网页端没有 preload，pan115 / 追更 / 库外发现等域
 * 改走同源 HTTP RPC + SSE，方法、参数、返回值与桌面端 IPC 完全一致。
 *
 * - 调用：POST {@link DOMAIN_HTTP.rpc}(domain, method)，请求体 `{ args: unknown[] }`（契约的参数元组），
 *   响应体 {@link DomainRpcReply}（处理函数抛错也以数据返回，HTTP 状态仍为 200）；
 * - 事件：GET {@link DOMAIN_HTTP.events} → text/event-stream，每条 data 是一个 {@link DomainEventMessage}。
 *
 * 只有类型和常量，渲染层与服务端共用。
 */

/** 路径（相对服务根） */
export const DOMAIN_HTTP = {
  /** POST { args } → DomainRpcReply */
  rpc: (domain: string, method: string): string =>
    `/api/domains/${encodeURIComponent(domain)}/${encodeURIComponent(method)}`,
  /** GET → text/event-stream，每条 data 是一个 DomainEventMessage */
  events: '/api/domains/events',
} as const

/** 一次调用的结果：成功带返回值，失败带人话 */
export type DomainRpcReply =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

/** 事件流里的一条事件 */
export interface DomainEventMessage {
  domain: string
  event: string
  payload: unknown
}
