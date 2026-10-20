/**
 * 主进程与引擎进程（utilityProcess）之间的消息格式。
 *
 * 渲染进程不直接接触这些消息：它通过 ipcRenderer.invoke 调主进程，主进程把调用包成
 * RpcRequest 转给引擎，再把 RpcResponse 拆回去。事件订阅则是把 MessagePort 转交给引擎。
 */
import type { LibraryMethod, LibraryRpcMap } from './contract'

/** 主进程 → 引擎：一次方法调用。 */
export interface RpcRequest<M extends LibraryMethod = LibraryMethod> {
  kind: 'request'
  id: number
  method: M
  params: LibraryRpcMap[M]['params']
}

/** 主进程 → 引擎：消息附带的 MessagePort 是一个新的事件订阅方。 */
export interface SubscribeMessage {
  kind: 'subscribe'
}

/** 主进程 → 引擎：应用退出，关闭数据库后自行退出。 */
export interface ShutdownMessage {
  kind: 'shutdown'
}

/** 主进程发给引擎的全部消息。 */
export type HostMessage = RpcRequest | SubscribeMessage | ShutdownMessage

/** 可序列化的错误。code 供调用方分支，message 给人看。 */
export interface RpcError {
  code: LibraryErrorCode
  message: string
}

/** 错误码。 */
export type LibraryErrorCode =
  | 'invalid-params'
  | 'not-found'
  | 'conflict'
  | 'unknown-method'
  | 'engine-unavailable'
  | 'internal'

/** 引擎 → 主进程：一次调用的结果。 */
export type RpcResponse =
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | { kind: 'response'; id: number; ok: false; error: RpcError }

/** 引擎 → 主进程：初始化完成，可以接收请求。 */
export interface ReadyMessage {
  kind: 'ready'
}

/** 引擎发给主进程的全部消息。 */
export type EngineMessage = RpcResponse | ReadyMessage

/** 渲染进程 ↔ 主进程的 IPC 通道名。 */
export const LIBRARY_CHANNELS = {
  /** ipcRenderer.invoke(channel, method, params) → InvokeResult */
  invoke: 'library:invoke',
  /** ipcRenderer.postMessage(channel, null, [port])：转交事件端口 */
  subscribe: 'library:subscribe',
} as const

/**
 * library:invoke 的返回值。错误以数据形式返回而不是抛出：Electron 会把 handle 里抛出的
 * 异常压成一段字符串，错误码就丢了；preload 收到 ok: false 再还原成带 code 的 Error。
 */
export type InvokeResult =
  | { ok: true; result: unknown }
  | { ok: false; error: RpcError }

const CODED_MESSAGE_RE = /^\[library:([a-z-]+)\] /

/**
 * 把错误码编进错误消息：contextBridge 跨世界传递 Error 时只保留 message，
 * code、name 等自定义属性都会丢，渲染进程只能从消息里取回错误码。
 */
export function encodeErrorMessage(error: RpcError): string {
  return `[library:${error.code}] ${error.message}`
}

/** 从渲染进程拿到的错误里取回错误码；不是引擎错误时返回 undefined。 */
export function libraryErrorCode(error: unknown): LibraryErrorCode | undefined {
  const message = error instanceof Error ? error.message : String(error)
  return CODED_MESSAGE_RE.exec(message)?.[1] as LibraryErrorCode | undefined
}

/** 带错误码的异常；跨进程时序列化为 RpcError，在调用方重新抛出。 */
export class LibraryError extends Error {
  constructor(
    readonly code: LibraryErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'LibraryError'
  }
}
