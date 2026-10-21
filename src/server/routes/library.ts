/**
 * 片库 API：POST rpc（复用 IPC 契约与 engine/rpc.ts 的参数校验）+ GET events（SSE 推送）。
 *
 * 服务端额外的两条规则（桌面端由主进程负责的部分）：
 * - addLibrary：根目录必须在配置的媒体根目录之内（见 roots.ts）；
 * - setProviderToken：成功后把令牌写进服务的密钥文件，重启后由 app.ts 补给片库（对应桌面端 safeStorage）。
 */
import {
  type InvokeResult,
  LibraryError,
  type LibraryEvent,
  type RpcResponse,
} from '../../shared/library/ipc'
import type { LibraryService } from '../../main/library/engine/service'
import { handleRpc } from '../../main/library/engine/rpc'
import { HttpError, type Router, json, readJson } from '../http/router'
import { type FileSecretStore, SECRET_KEYS } from '../secrets'
import { resolveWithinRoots } from './roots'

/** 依赖。 */
export interface LibraryRouteDeps {
  service: LibraryService
  secrets: FileSecretStore
  mediaRoots: readonly string[]
}

/** SSE 心跳间隔：低于常见反向代理的 60 s 空闲超时。 */
const HEARTBEAT_MS = 25_000

const toInvokeResult = (response: RpcResponse): InvokeResult =>
  response.ok
    ? { ok: true, result: response.result }
    : { ok: false, error: response.error }

const rejected = (error: LibraryError): InvokeResult => ({
  ok: false,
  error: { code: error.code, message: error.message },
})

/** addLibrary 的根目录检查：返回替换成真实路径的参数。 */
async function checkLibraryRoot(
  params: unknown,
  roots: readonly string[]
): Promise<unknown> {
  const root = (params as { root?: unknown } | null)?.root
  if (typeof root !== 'string' || !root.trim()) return params
  const resolved = await resolveWithinRoots(root.trim(), roots).catch(() => {
    throw new LibraryError('invalid-params', `文件夹不存在：${root}`)
  })
  if (!resolved)
    throw new LibraryError(
      'invalid-params',
      `只能添加媒体根目录（${roots.join('、')}）里的文件夹`
    )
  return { ...(params as object), root: resolved }
}

/** 一次 RPC。 */
async function invoke(
  deps: LibraryRouteDeps,
  method: unknown,
  params: unknown
): Promise<InvokeResult> {
  try {
    if (method === 'addLibrary')
      params = await checkLibraryRoot(params, deps.mediaRoots)
  } catch (error) {
    if (error instanceof LibraryError) return rejected(error)
    throw error
  }
  const result = toInvokeResult(
    await handleRpc(deps.service, { id: 0, method, params })
  )
  // 只有 TMDB 令牌另存进服务的密钥文件（与桌面端 safeStorage 对应）；番号站点凭据存在片库设置里
  if (method === 'setProviderToken' && result.ok) {
    const request = params as { provider?: string; token?: string | null }
    if (request.provider === 'tmdb')
      deps.secrets.set(SECRET_KEYS.tmdbToken, request.token ?? null)
  }
  return result
}

/** 事件流：每个事件一条 data，定时发注释行保活；客户端断开时退订。 */
function eventStream(service: LibraryService, signal: AbortSignal): Response {
  const encoder = new TextEncoder()
  let cleanup = (): void => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string): void => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          cleanup()
        }
      }
      const unsubscribe = service.subscribe((event: LibraryEvent) =>
        send(`data: ${JSON.stringify(event)}\n\n`)
      )
      const timer = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS)
      cleanup = () => {
        clearInterval(timer)
        unsubscribe()
      }
      signal.addEventListener('abort', () => cleanup(), { once: true })
      send('retry: 3000\n: connected\n\n')
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // 关掉 nginx 等反向代理的缓冲，事件即时到达
      'X-Accel-Buffering': 'no',
    },
  })
}

/** 登记片库路由。 */
export function registerLibraryRoutes(
  router: Router,
  deps: LibraryRouteDeps
): void {
  router.add('POST', '/api/library/rpc', async request => {
    const body = (await readJson(request)) as {
      method?: unknown
      params?: unknown
    } | null
    if (!body || typeof body !== 'object')
      throw new HttpError(400, '请求体应为 { method, params }')
    return json(await invoke(deps, body.method, body.params))
  })
  router.add('GET', '/api/library/events', request =>
    eventStream(deps.service, request.signal)
  )
}
