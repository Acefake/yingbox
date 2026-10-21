/**
 * window.api.library 的实现：invoke 走 library:invoke，subscribe 新建 MessageChannel，
 * 把一端经 library:subscribe 交给主进程转给引擎，事件从另一端直达，不经主进程转发。
 *
 * 依赖以参数注入（ipcRenderer、MessageChannel），单测可以用假的实现。
 */
import {
  type InvokeResult,
  LIBRARY_CHANNELS,
  type LibraryBridge,
  type LibraryEvent,
  type LibraryMethod,
  type LibraryRpcMap,
  createActorsBridge,
  encodeErrorMessage,
} from '../shared/library/ipc'

/** 事件端口的最小形状（DOM MessagePort 的子集；preload 的 tsconfig 没有 DOM 类型）。 */
export interface EventPort {
  onmessage: ((event: { data: unknown }) => void) | null
  start(): void
  close(): void
}

/** MessageChannel 的最小形状：port1 留在本地收事件，port2 交给引擎。 */
export interface EventChannel {
  port1: EventPort
  port2: unknown
}

/** bridge 需要的 ipcRenderer 子集。 */
export interface LibraryIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  postMessage(channel: string, message: unknown, transfer?: unknown[]): void
}

/** 用渲染环境自带的 MessageChannel 建通道。 */
const domChannel = (): EventChannel =>
  new (
    globalThis as unknown as { MessageChannel: new () => EventChannel }
  ).MessageChannel()

/**
 * 引擎返回的错误。preload 内部带 code 属性；到了渲染进程（contextBridge 之后）只剩 message，
 * 用 libraryErrorCode(error) 取错误码。
 */
export interface LibraryBridgeError extends Error {
  code: string
}

/** 创建 library bridge。 */
export function createLibraryBridge(
  ipc: LibraryIpc,
  createChannel: () => EventChannel = domChannel
): LibraryBridge {
  const call = async <M extends LibraryMethod>(
    method: M,
    params?: LibraryRpcMap[M]['params']
  ): Promise<LibraryRpcMap[M]['result']> => {
    const response = (await ipc.invoke(
      LIBRARY_CHANNELS.invoke,
      method,
      params
    )) as InvokeResult
    if (response.ok) return response.result as LibraryRpcMap[M]['result']
    // 跨 contextBridge 只有 message 能保留下来，错误码编进消息，渲染进程用 libraryErrorCode 取回
    const error = new Error(
      encodeErrorMessage(response.error)
    ) as LibraryBridgeError
    error.name = 'LibraryError'
    error.code = response.error.code
    throw error
  }

  return {
    listLibraries: () => call('listLibraries'),
    addLibrary: request => call('addLibrary', request),
    removeLibrary: libraryId => call('removeLibrary', { libraryId }),
    updateLibrary: request => call('updateLibrary', request),
    scan: request => call('scan', request),
    query: (query = {}) => call('query', query),
    getItem: itemId => call('getItem', { itemId }),
    identify: request => call('identify', request),
    getMatchCandidates: itemId => call('getMatchCandidates', { itemId }),
    applyMatch: request => call('applyMatch', request),
    lockMatch: itemId => call('lockMatch', { itemId }),
    unlockMatch: itemId => call('unlockMatch', { itemId }),
    refreshMetadata: request => call('refreshMetadata', request),
    getProviderStatus: () => call('getProviderStatus'),
    writer: {
      getSettings: () => call('writer.getSettings'),
      setSettings: settings => call('writer.setSettings', settings),
      write: itemIds => call('writer.write', { itemIds }),
      previewOrganize: itemIds => call('writer.previewOrganize', { itemIds }),
      applyOrganize: planId => call('writer.applyOrganize', { planId }),
      undoOrganize: batchId => call('writer.undoOrganize', { batchId }),
      listOrganizeBatches: () => call('writer.listOrganizeBatches'),
    },
    jav: {
      getSettings: () => call('jav.getSettings'),
      setSettings: settings => call('jav.setSettings', settings),
      setCredential: (provider, token) =>
        call('setProviderToken', { provider, token }),
    },
    actors: createActorsBridge(call),
    subscribe(listener: (event: LibraryEvent) => void): () => void {
      const { port1, port2 } = createChannel()
      port1.onmessage = event => listener(event.data as LibraryEvent)
      port1.start()
      ipc.postMessage(LIBRARY_CHANNELS.subscribe, null, [port2])
      return () => port1.close()
    },
  }
}
