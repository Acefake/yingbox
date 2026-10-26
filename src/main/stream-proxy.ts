/**
 * HLS / 直播跨域传输：只转发公网 GET/HEAD 和 Range，不携带浏览器 Cookie 或认证头。
 * IPTV 源大多不回 CORS 头、只有 http，渲染层的 hls.js 与 <video> 一律经这里取清单与分片。
 * 独立服务的 /api/stream 复用 proxyStream（另加 m3u8 改写，见 src/server/online/stream）。
 * 超时只管「等响应头」：直播流与大文件的响应体会持续很久，不能按总时长掐断。
 */
import { refererFor } from '../shared/net/media-referer'
import type { NetClient } from '../shared/net/client'
import { STREAM_RESPONSE_URL, STREAM_SCHEME } from '../shared/stream-url'

/** 同一主机同一原因的日志在这段时间内只打一次，避免分片失败刷屏 */
const LOG_WINDOW_MS = 10_000
/** 等上游响应头的上限（含所有重定向）；超时回 504 */
export const STREAM_CONNECT_MS = 20_000
/** 失败原因回给渲染层的响应头（不含完整地址） */
export const STREAM_ERROR_HEADER = 'X-Yingbox-Error'

/**
 * 记录转发失败（直播、在线 HLS 排查用）：只打主机与原因，不打完整地址（可能带令牌）。
 * 返回日志函数，按「主机 + 原因」去重。
 */
export function createFailureLog(
  now: () => number = Date.now
): (source: string, reason: string) => void {
  const last = new Map<string, number>()
  return (source, reason) => {
    let host = source
    try {
      host = new URL(source).host
    } catch {
      // 地址无效：原样记录
    }
    const key = `${host} ${reason}`
    const at = now()
    if (at - (last.get(key) ?? -Infinity) < LOG_WINDOW_MS) return
    last.set(key, at)
    if (last.size > 200) last.delete(last.keys().next().value as string)
    console.warn(`[stream] ${key}`)
  }
}

/** proxyStream 的选项。 */
export interface ProxyStreamOptions {
  /** 失败日志（按主机 + 原因去重） */
  logFailure: (source: string, reason: string) => void
  /** 等上游响应头的上限 */
  connectMs?: number
  /** 加跨域头（桌面端自定义协议需要；独立服务同源、带鉴权，不加） */
  cors?: boolean
}

/**
 * 转发一次 GET / HEAD：透传 Range，按源注入防盗链 Referer（shared/net/media-referer），UA 由 net 客户端补默认值，
 * 不带浏览器的 Cookie 与认证头。桌面端自定义协议与独立服务的 /api/stream 共用。
 */
export async function proxyStream(
  net: NetClient,
  source: string,
  request: Request,
  options: ProxyStreamOptions
): Promise<Response> {
  const cors: Record<string, string> = options.cors
    ? { 'Access-Control-Allow-Origin': '*' }
    : {}
  const headers: Record<string, string> = {}
  const range = request.headers.get('range')
  if (range) headers.Range = range
  const referer = refererFor(source)
  if (referer) headers.Referer = referer
  const connect = new AbortController()
  const timer = setTimeout(
    () => connect.abort(),
    options.connectMs ?? STREAM_CONNECT_MS
  )
  try {
    const { response, url: finalUrl } = await net.open(source, {
      method: request.method as 'GET' | 'HEAD',
      headers,
      signal: AbortSignal.any([request.signal, connect.signal]),
      // 总时长不设限（直播流一直在传），连接阶段由上面的计时器管
      timeoutMs: 2 ** 31 - 1,
    })
    clearTimeout(timer)
    const result = new Headers({
      ...cors,
      ...(options.cors
        ? { 'Access-Control-Expose-Headers': STREAM_RESPONSE_URL }
        : {}),
      [STREAM_RESPONSE_URL]: finalUrl,
    })
    // fetch 的响应体已解码，流式转发时不声明上游编码后的 Content-Length。
    for (const name of [
      'content-type',
      'content-range',
      'accept-ranges',
      'cache-control',
      'age',
    ]) {
      const value = response.headers.get(name)
      if (value) result.set(name, value)
    }
    if (response.status >= 400)
      options.logFailure(source, `HTTP ${response.status}`)
    return new Response(response.body, {
      status: response.status,
      headers: result,
    })
  } catch (error) {
    clearTimeout(timer)
    if (request.signal.aborted) return new Response(null, { status: 502 })
    const timedOut = connect.signal.aborted
    const reason = timedOut
      ? '连接超时'
      : (error as Error).message || String(error)
    options.logFailure(source, reason)
    return new Response(null, {
      status: timedOut ? 504 : 502,
      headers: {
        ...cors,
        ...(options.cors
          ? { 'Access-Control-Expose-Headers': STREAM_ERROR_HEADER }
          : {}),
        [STREAM_ERROR_HEADER]: encodeURIComponent(reason),
      },
    })
  }
}

/** 桌面端 yingbox-stream://fetch/?src= 协议的处理函数。 */
export function createStreamHandler(
  net: NetClient,
  logFailure: (source: string, reason: string) => void = createFailureLog(),
  connectMs = STREAM_CONNECT_MS
): (request: Request) => Promise<Response> {
  return async request => {
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response(null, { status: 405 })
    const url = new URL(request.url)
    if (
      url.protocol !== `${STREAM_SCHEME}:` ||
      url.host !== 'fetch' ||
      url.pathname !== '/'
    )
      return new Response(null, { status: 400 })
    return proxyStream(net, url.searchParams.get('src') ?? '', request, {
      logFailure,
      connectMs,
      cors: true,
    })
  }
}
