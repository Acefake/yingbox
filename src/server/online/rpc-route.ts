/**
 * 引擎 API：POST /api/engine/rpc（契约调用）+ GET /api/engine/events（SSE 推引擎事件）。
 *
 * 与桌面端 IPC 边界（main/rpc 的 implement）同一套规则：通道必须是开放域（ENGINE_HTTP_DOMAINS）里
 * 声明过的异步调用，参数先经契约的 parse 解析，不合法时不转发；解析后的参数原样交给引擎。
 * 错误编码进 EngineRpcResult：invalid-params / unavailable（引擎崩溃、停止重启、关停）/ engine。
 */
import { av } from '../../shared/contract/av'
import {
  ContractError,
  type Domain,
  channelOf,
} from '../../shared/contract/define'
import { download } from '../../shared/contract/download'
import { online } from '../../shared/contract/online'
import {
  ENGINE_HTTP,
  type EngineEventMessage,
  type EngineRpcResult,
} from '../../shared/engine-http'
import { UtilityCallError } from '../../main/utility/host'
import { HttpError, type Router, json, readJson } from '../http/router'
import type { ServerEngine } from './engine'

/** 开放的域（与 ENGINE_HTTP_DOMAINS 一致）。 */
const DOMAINS: readonly Domain[] = [online, av, download]

/** 通道名 → 参数解析器（只含异步调用）。 */
const PARSERS = new Map(
  DOMAINS.flatMap(domain =>
    Object.entries(domain.calls)
      .filter(([, def]) => def.kind === 'call')
      .map(([key, def]) => [channelOf(domain.name, key), def.parse] as const)
  )
)

/** 事件通道（订阅方只收这些）。 */
const EVENT_CHANNELS = new Set(
  DOMAINS.flatMap(domain =>
    Object.keys(domain.events).map(key => channelOf(domain.name, key))
  )
)

/** SSE 心跳间隔：低于常见反向代理的 60 s 空闲超时。 */
const HEARTBEAT_MS = 25_000

/** 一次调用。 */
export async function invokeEngine(
  engine: ServerEngine,
  channel: unknown,
  rawArgs: unknown
): Promise<EngineRpcResult> {
  const parse = typeof channel === 'string' ? PARSERS.get(channel) : undefined
  if (!parse || typeof channel !== 'string')
    return {
      ok: false,
      error: { code: 'invalid-params', message: `没有这个调用：${channel}` },
    }
  if (rawArgs !== undefined && !Array.isArray(rawArgs))
    return {
      ok: false,
      error: { code: 'invalid-params', message: 'args 应为数组' },
    }
  let args: unknown[]
  try {
    args = parse(rawArgs ?? [])
  } catch (error) {
    if (error instanceof ContractError)
      return {
        ok: false,
        error: {
          code: 'invalid-params',
          message: `[${channel}] ${error.message}`,
        },
      }
    throw error
  }
  try {
    return { ok: true, value: await engine.invoke(channel, args) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof UtilityCallError ? error.code : undefined
    return { ok: false, error: { code: code ?? 'engine', message } }
  }
}

/** 事件流。 */
function eventStream(engine: ServerEngine, signal: AbortSignal): Response {
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
      const unsubscribe = engine.subscribe((event: EngineEventMessage) => {
        if (EVENT_CHANNELS.has(event.channel))
          send(`data: ${JSON.stringify(event)}\n\n`)
      })
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

/** 登记引擎 API。 */
export function registerEngineRoutes(
  router: Router,
  engine: ServerEngine
): void {
  router.add('POST', ENGINE_HTTP.rpc, async request => {
    const body = (await readJson(request)) as {
      channel?: unknown
      args?: unknown
    } | null
    if (!body || typeof body !== 'object')
      throw new HttpError(400, '请求体应为 { channel, args }')
    return json(await invokeEngine(engine, body.channel, body.args))
  })
  router.add('GET', ENGINE_HTTP.events, request =>
    eventStream(engine, request.signal)
  )
}
