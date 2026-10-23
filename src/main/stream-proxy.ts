/** HLS 跨域传输：只转发公网 GET/HEAD 和 Range，不携带浏览器 Cookie 或认证头。 */
import { refererFor } from '../shared/net/media-referer'
import type { NetClient } from '../shared/net/client'
import { STREAM_RESPONSE_URL, STREAM_SCHEME } from '../shared/stream-url'

export function createStreamHandler(
  net: NetClient
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
      for (const name of [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'cache-control',
        'age',
      ]) {
        const value = response.headers.get(name)
        if (value) result.set(name, value)
      }
      return new Response(response.body, {
        status: response.status,
        headers: result,
      })
    } catch {
      return new Response(null, { status: 502 })
    }
  }
}
