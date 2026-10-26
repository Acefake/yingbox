/**
 * 契约域的 HTTP 路由：POST /api/domains/:domain/:method（调用）+ GET /api/domains/events（SSE）。
 * 线格式见 shared/contract/http-wire.ts；鉴权、同源检查由 app.ts 的入口统一做。
 */
import { DOMAIN_HTTP } from '../../shared/contract/http-wire'
import { HttpError, type Router, json, readJson } from '../http/router'
import type { DomainRegistry } from './registry'

/** SSE 心跳间隔：低于常见反向代理的 60 s 空闲超时 */
const HEARTBEAT_MS = 25_000

/** 事件流：每个事件一条 data，定时发注释行保活；客户端断开时退订 */
function eventStream(registry: DomainRegistry, signal: AbortSignal): Response {
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
      const unsubscribe = registry.subscribe(message =>
        send(`data: ${JSON.stringify(message)}\n\n`)
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
      'X-Accel-Buffering': 'no',
    },
  })
}

/** 登记契约域路由 */
export function registerDomainRoutes(
  router: Router,
  registry: DomainRegistry
): void {
  router.add('GET', DOMAIN_HTTP.events, request =>
    eventStream(registry, request.signal)
  )
  router.add(
    'POST',
    '/api/domains/:domain/:method',
    async (request, { params }) => {
      const body = (await readJson(request)) as { args?: unknown } | null
      if (!body || typeof body !== 'object')
        throw new HttpError(400, '请求体应为 { args }')
      return json(
        await registry.invoke(params.domain, params.method, body.args ?? [])
      )
    }
  )
}
