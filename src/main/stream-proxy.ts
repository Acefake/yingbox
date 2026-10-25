/** HLS 跨域传输：只转发公网 GET/HEAD 和 Range，不携带浏览器 Cookie 或认证头。 */
import { refererFor } from '../shared/net/media-referer'
import type { NetClient } from '../shared/net/client'
import { STREAM_RESPONSE_URL, STREAM_SCHEME } from '../shared/stream-url'

/** 同一主机同一原因的日志在这段时间内只打一次，避免分片失败刷屏 */
const LOG_WINDOW_MS = 10_000

/**
 * 记录转发失败（直播、在线 HLS 排查用）：只打主机与原因，不打完整地址（可能带令牌）。
 * 返回日志函数，按「主机 + 原因」去重。
 */
function createFailureLog(
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

export function createStreamHandler(
  net: NetClient,
  logFailure: (source: string, reason: string) => void = createFailureLog()
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
    const source = url.searchParams.get('src') ?? ''
    const headers: Record<string, string> = {}
    const range = request.headers.get('range')
    if (range) headers.Range = range
    const referer = refererFor(source)
    if (referer) headers.Referer = referer
    try {
      const { response, url: finalUrl } = await net.open(source, {
        method: request.method as 'GET' | 'HEAD',
        headers,
        signal: request.signal,
        timeoutMs: 60_000,
      })
      const result = new Headers({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': STREAM_RESPONSE_URL,
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
      if (response.status >= 400) logFailure(source, `HTTP ${response.status}`)
      return new Response(response.body, {
        status: response.status,
        headers: result,
      })
    } catch (error) {
      if (!request.signal.aborted)
        logFailure(source, (error as Error).message || String(error))
      return new Response(null, { status: 502 })
    }
  }
}
