/**
 * 媒体库的 IPC 通道名、调用结果与错误码。
 *
 * 渲染进程通过 ipcRenderer.invoke 调主进程，主进程按 shared/utility/protocol.ts 的线协议
 * 转给引擎（call / result，参数为 args[0]），再拆回 InvokeResult。事件订阅：主进程建
 * MessageChannelMain，一端随 subscribe 消息交给引擎、另一端经 library:port 推给渲染进程；
 * 引擎重启后重新下发。
 */

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

/**
 * 引擎 → 主进程的事件通道（线协议 event，见 shared/utility/protocol.ts）：一批原图已下载到缓存目录，
 * payload 为图片 key 数组，主进程据此预热缩略图。
 */
export const LIBRARY_IMAGES_CACHED = 'library:images-cached'

/** 渲染进程 ↔ 主进程的 IPC 通道名。 */
export const LIBRARY_CHANNELS = {
  /** ipcRenderer.invoke(channel, method, params) → InvokeResult */
  invoke: 'library:invoke',
  /** ipcRenderer.send(channel)：本窗口登记为事件订阅方（重复发送等于重新订阅） */
  subscribe: 'library:subscribe',
  /** ipcRenderer.send(channel)：本窗口退订，之后引擎重启不再下发端口 */
  unsubscribe: 'library:unsubscribe',
  /**
   * 主进程 → 渲染进程 webContents.postMessage(channel, null, [port])：一条直达引擎的事件端口。
   * 每次（重新）订阅、每次引擎重启都会下发新端口，渲染进程用新的替换旧的。
   */
  port: 'library:port',
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
