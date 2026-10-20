/**
 * 引擎的 RPC 入口：解析请求参数（系统边界）、调用服务方法、把结果或错误包成响应。
 * 纯函数式，不依赖 Electron，单测直接喂 RpcRequest。
 */
import {
  LibraryError,
  type LibraryMethod,
  type LibraryRpcMap,
  type ParsedRpcParams,
  type RpcResponse,
  isLibraryMethod,
  parseRpcParams,
} from '../../../shared/library/ipc'
import type { LibraryService } from './service'

/** 每个方法如何调用服务。参数已经过 parseRpcParams 解析。 */
type Handlers = {
  [M in LibraryMethod]: (
    service: LibraryService,
    params: ParsedRpcParams<M>
  ) => LibraryRpcMap[M]['result'] | Promise<LibraryRpcMap[M]['result']>
}

const HANDLERS: Handlers = {
  listLibraries: s => s.listLibraries(),
  addLibrary: (s, p) => s.addLibrary(p),
  removeLibrary: (s, p) => s.removeLibrary(p),
  scan: (s, p) => s.scan(p),
  query: (s, p) => s.query(p),
  getItem: (s, p) => s.getItem(p),
  identify: (s, p) => s.identify(p),
  getMatchCandidates: (s, p) => s.getMatchCandidates(p),
  applyMatch: (s, p) => s.applyMatch(p),
  lockMatch: (s, p) => s.lockMatch(p),
  unlockMatch: (s, p) => s.unlockMatch(p),
  refreshMetadata: (s, p) => s.refreshMetadata(p),
  setProviderToken: (s, p) => s.setProviderToken(p),
  getProviderStatus: s => s.getProviderStatus(),
  'writer.getSettings': s => s.writer.getSettings(),
  'writer.setSettings': (s, p) => s.writer.setSettings(p),
  'writer.write': (s, p) => s.writer.write(p.itemIds),
  'writer.previewOrganize': (s, p) => s.writer.previewOrganize(p.itemIds),
  'writer.applyOrganize': (s, p) => s.writer.applyOrganize(p.planId),
  'writer.undoOrganize': (s, p) => s.writer.undoOrganize(p.batchId),
  'writer.listOrganizeBatches': s => s.writer.listOrganizeBatches(),
}

/** 处理一次调用，永不抛出：任何错误都变成 ok: false 的响应。 */
export async function handleRpc(
  service: LibraryService,
  request: { id: number; method: unknown; params: unknown }
): Promise<RpcResponse> {
  try {
    if (!isLibraryMethod(request.method)) {
      throw new LibraryError(
        'unknown-method',
        `未知方法：${String(request.method)}`
      )
    }
    const method = request.method
    const params = parseRpcParams(method, request.params)
    const handler = HANDLERS[method] as (
      s: LibraryService,
      p: typeof params
    ) => unknown
    const result = await handler(service, params)
    return { kind: 'response', id: request.id, ok: true, result }
  } catch (error) {
    const known = error instanceof LibraryError
    return {
      kind: 'response',
      id: request.id,
      ok: false,
      error: {
        code: known ? error.code : 'internal',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
