/**
 * window.api.library 的实现：invoke 走 library:invoke；subscribe 经 library:subscribe 登记本窗口，
 * 主进程把一条直达引擎的 MessagePort 经 library:port 推过来，事件从这个端口直达，不经主进程转发。
 *
 * 引擎崩溃重启后主进程会再推一个新端口：这里收到新端口就关掉旧的、把现有监听者全部挂到新端口上，
 * 渲染层的监听者不用感知重启。
 *
 * 依赖以参数注入（ipcRenderer 子集），单测可以用假的实现。
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

/** bridge 需要的 ipcRenderer 子集。 */
export interface LibraryIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send(channel: string, ...args: unknown[]): void
  on(
    channel: string,
    // ports 用 unknown：preload 没有 DOM 类型，带 DOM 的 tsconfig 里 MessagePort 又和 EventPort 不兼容
    listener: (event: { ports: readonly unknown[] }) => void
  ): unknown
}

/**
 * 引擎返回的错误。preload 内部带 code 属性；到了渲染进程（contextBridge 之后）只剩 message，
 * 用 libraryErrorCode(error) 取错误码。
 */
export interface LibraryBridgeError extends Error {
  code: string
}

/** 创建 library bridge。 */
export function createLibraryBridge(ipc: LibraryIpc): LibraryBridge {
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

  const listeners = new Set<(event: LibraryEvent) => void>()
  let port: EventPort | null = null
  const dispatch = (event: LibraryEvent): void => {
    for (const listener of listeners) listener(event)
  }
  // 每次（重新）订阅、每次引擎重启，主进程都推一个新端口：换掉旧的；已经没人听了就直接关掉
  ipc.on(LIBRARY_CHANNELS.port, ({ ports }) => {
    const next = ports[0] as EventPort | undefined
    if (!next) return
    port?.close()
    port = null
    if (listeners.size === 0) {
      next.close()
      return
    }
    next.onmessage = event => dispatch(event.data as LibraryEvent)
    next.start()
    port = next
  })

  return {
    listLibraries: () => call('listLibraries'),
    addLibrary: request => call('addLibrary', request),
    removeLibrary: libraryId => call('removeLibrary', { libraryId }),
    updateLibrary: request => call('updateLibrary', request),
    scan: request => call('scan', request),
    query: (query = {}) => call('query', query),
    getItem: itemId => call('getItem', { itemId }),
    getPreview: itemId => call('getPreview', { itemId }),
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
    facets: { list: request => call('facets.list', request) },
    subscribe(listener: (event: LibraryEvent) => void): () => void {
      listeners.add(listener)
      if (listeners.size === 1) ipc.send(LIBRARY_CHANNELS.subscribe)
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return
        port?.close()
        port = null
        ipc.send(LIBRARY_CHANNELS.unsubscribe)
      }
    },
  }
}
