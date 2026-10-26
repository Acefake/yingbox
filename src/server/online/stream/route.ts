/**
 * 播放代理路由 GET/HEAD /api/stream?src=<地址>[&ua=&referer=]：网页端在线播放的清单、分片、直链都经这里取。
 *
 * - 鉴权：与其它 /api 路由相同（Cookie / Bearer），不是公开路由；
 * - 防 SSRF：只允许无凭据的 http/https 公网目标，每一跳重定向都校验；内网目标要显式放行（guard.ts）；
 * - 请求头：透传 Range，按源注入 Referer（shared/net/media-referer，与桌面端 media-headers 同一份名单），
 *   UA 用引擎同款 Chrome UA；线路自带的 ua / referer 参数（net/stream-headers 校验，只认这两个头）覆盖它们；
 *   不带浏览器的 Cookie；
 * - m3u8：按正文开头认出清单（不靠后缀与类型），整份读进来（上限 8 MB）改写地址后返回（m3u8.ts）；
 *   带 Range 的请求、音视频类型与其它正文原样流式转发；改写出的地址带上同样的 ua / referer 参数。
 * 转发本身复用桌面端 yingbox-stream:// 的 proxyStream（main/stream-proxy.ts）。
 */
import { lookup } from 'node:dns/promises'
import { createFailureLog, proxyStream } from '../../../main/stream-proxy'
import { STREAM_RESPONSE_URL } from '../../../shared/stream-url'
import { type NetClient, createNetClient } from '../../../shared/net/client'
import { BlockedTargetError, type LookupAll } from '../../../shared/net/guard'
import {
  type StreamHeaders,
  readStreamHeaderQuery,
} from '../../../shared/net/stream-headers'
import { ENGINE_HTTP, streamProxyPath } from '../../../shared/engine-http'
import { type Router, fail } from '../../http/router'
import { type StreamGuard, createStreamGuard } from './guard'
import { looksLikePlaylist, mayBePlaylist, rewritePlaylist } from './m3u8'

/** 清单读入上限。 */
const MAX_PLAYLIST_BYTES = 8 * 1024 * 1024

/** 依赖（测试注入 fetch / lookup）。 */
export interface StreamRouteDeps {
  allowPrivate: readonly string[]
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  lookup?: LookupAll
  /** 失败日志，缺省按主机 + 原因去重写到 stderr */
  logFailure?: (source: string, reason: string) => void
}

/** 嗅探清单要读到的字节数：上游可能把开头拆成很小的块（甚至逐字节），够 BOM + 空白 + #EXTM3U 再判断。 */
const SNIFF_BYTES = 64

/** 把已读出的开头几块放回去，接着转发剩下的流。 */
function replay(
  head: Uint8Array[],
  reader: ReadableStreamDefaultReader<Uint8Array>
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of head) controller.enqueue(chunk)
    },
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel: reason => reader.cancel(reason),
  })
}

/**
 * 读开头若干块直到够 SNIFF_BYTES 字节或流结束，看是不是清单：是就整份读进来（上限 MAX_PLAYLIST_BYTES）
 * 改写地址；不是就把读出的块放回去原样流式转发（大文件不会被整份读进内存）。
 * 改写后的正文长度与上游不同，不带上游的 Content-Length（由运行时按新正文计算）。
 */
async function maybeRewrite(
  response: Response,
  source: string,
  streamHeaders: StreamHeaders | undefined
): Promise<Response> {
  const reader = response.body?.getReader()
  if (!reader) return response
  const headers = new Headers(response.headers)
  const chunks: Uint8Array[] = []
  let size = 0
  let ended = false
  while (size < SNIFF_BYTES) {
    const { done, value } = await reader.read()
    if (done) {
      ended = true
      break
    }
    chunks.push(value)
    size += value.byteLength
  }
  if (!size) return new Response(null, { status: response.status, headers })
  const head = new TextDecoder().decode(
    Buffer.concat(chunks).subarray(0, SNIFF_BYTES)
  )
  if (!looksLikePlaylist(head))
    return new Response(
      ended ? Buffer.concat(chunks) : replay(chunks, reader),
      { status: response.status, headers }
    )
  while (!ended) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_PLAYLIST_BYTES) {
      await reader.cancel().catch(() => {})
      return fail(502, '清单过大')
    }
    chunks.push(value)
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks))
  const base = headers.get(STREAM_RESPONSE_URL) || source
  headers.set('content-type', 'application/vnd.apple.mpegurl')
  headers.set('cache-control', 'no-store')
  headers.delete('content-length')
  return new Response(
    rewritePlaylist(text, base, absolute =>
      streamProxyPath(absolute, streamHeaders)
    ),
    {
      status: response.status,
      headers,
    }
  )
}

/** 处理一次代理请求。 */
export function createStreamProxy(
  deps: StreamRouteDeps
): (request: Request, url: URL) => Promise<Response> {
  const guard: StreamGuard = createStreamGuard(deps.allowPrivate)
  const lookupAll: LookupAll =
    deps.lookup ?? (host => lookup(host, { all: true }))
  const net: NetClient = createNetClient({
    fetch: deps.fetch ?? ((target, init) => fetch(target, init)),
    lookup: lookupAll,
    guard,
  })
  const logFailure = deps.logFailure ?? createFailureLog()
  return async (request, url) => {
    const source = url.searchParams.get('src') ?? ''
    try {
      await guard(source, lookupAll)
    } catch (error) {
      if (error instanceof BlockedTargetError) return fail(403, error.message)
      throw error
    }
    const streamHeaders = readStreamHeaderQuery(url.searchParams)
    const response = await proxyStream(net, source, request, {
      logFailure,
      headers: streamHeaders,
    })
    const ranged = request.headers.has('range')
    if (
      request.method !== 'GET' ||
      ranged ||
      !response.ok ||
      !mayBePlaylist(response.headers.get('content-type') ?? '')
    )
      return response
    return maybeRewrite(response, source, streamHeaders)
  }
}

/** 登记 /api/stream。 */
export function registerStreamRoute(
  router: Router,
  deps: StreamRouteDeps
): void {
  const proxy = createStreamProxy(deps)
  router.add('GET', ENGINE_HTTP.stream, (request, { url }) =>
    proxy(request, url)
  )
}
