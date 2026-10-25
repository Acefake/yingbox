/**
 * 网页端的片库 transport：实现与 window.api.library 相同的 LibraryBridge，经 HTTP 调独立片库服务。
 *
 * - 调用：POST /api/library/rpc { method, params } → InvokeResult，方法与参数与桌面端 IPC 一字不差；
 * - 事件：一个 EventSource（SSE），断线由浏览器自动重连；
 * - 错误：与 preload 一样把错误码编进消息（[library:code] 原因），界面照旧用 errorText / libraryErrorCode。
 *
 * 依赖以参数注入（请求函数、EventSource 构造），单测用假的实现。
 */
import {
  type InvokeResult,
  LIBRARY_HTTP,
  type LibraryBridge,
  type LibraryEvent,
  type LibraryMethod,
  type LibraryRpcMap,
  createActorsBridge,
  encodeErrorMessage,
} from '../../../../../shared/library/ipc'

/** 请求函数（同源 fetch 的子集）。 */
export type HttpRequest = (path: string, init: RequestInit) => Promise<Response>

/** 打开的事件流（EventSource 的包装）。 */
export interface EventStream {
  close(): void
}

/** 依赖。 */
export interface HttpBridgeDeps {
  request: HttpRequest
  /** 打开事件流，每条消息的 data 交给 onData。 */
  openEvents: (url: string, onData: (data: string) => void) => EventStream
}

/** HTTP 状态码 → 引擎错误码（服务没有回 InvokeResult 时）。 */
function transportError(status: number, text: string): Error {
  const message =
    status === 401
      ? '需要登录片库服务'
      : status === 0
        ? '无法连接片库服务'
        : `片库服务出错（HTTP ${status}）${text ? `：${text}` : ''}`
  const error = new Error(
    encodeErrorMessage({ code: 'engine-unavailable', message })
  )
  error.name = 'LibraryError'
  return error
}

/** 创建网页端 bridge。 */
export function createHttpLibraryBridge(deps: HttpBridgeDeps): LibraryBridge {
  const call = async <M extends LibraryMethod>(
    method: M,
    params?: LibraryRpcMap[M]['params']
  ): Promise<LibraryRpcMap[M]['result']> => {
    let response: Response
    try {
      response = await deps.request(LIBRARY_HTTP.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
      })
    } catch {
      throw transportError(0, '')
    }
    if (!response.ok)
      throw transportError(
        response.status,
        await response.text().catch(() => '')
      )
    const result = (await response.json()) as InvokeResult
    if (result.ok) return result.result as LibraryRpcMap[M]['result']
    const error = new Error(encodeErrorMessage(result.error))
    error.name = 'LibraryError'
    throw error
  }

  // 一个页面只开一条 SSE，多个订阅方共用
  const listeners = new Set<(event: LibraryEvent) => void>()
  let stream: EventStream | null = null

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
    setProviderToken: token =>
      call('setProviderToken', { provider: 'tmdb', token }),
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
    visual: {
      status: () => call('visual.status'),
      index: () => call('visual.index'),
      search: request => call('visual.search', request),
    },
    calendar: { episodes: request => call('calendar.episodes', request) },
    progress: {
      list: itemIds => call('progress.list', { itemIds }),
      save: reports => call('progress.save', { reports }),
      summary: itemIds => call('progress.summary', { itemIds }),
      recent: limit => call('progress.recent', limit ? { limit } : {}),
    },
    subscribe(listener) {
      listeners.add(listener)
      stream ??= deps.openEvents(LIBRARY_HTTP.events, data => {
        let event: LibraryEvent
        try {
          event = JSON.parse(data) as LibraryEvent
        } catch {
          return
        }
        for (const each of listeners) each(event)
      })
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && stream) {
          stream.close()
          stream = null
        }
      }
    },
  }
}
