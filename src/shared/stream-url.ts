/** 桌面 HLS 传输入口；网页端继续使用服务端媒体地址。 */
import { type StreamHeaders, streamHeaderQuery } from './net/stream-headers'

export const STREAM_SCHEME = 'yingbox-stream'
export const STREAM_RESPONSE_URL = 'X-Yingbox-Response-Url'

/** 经桌面播放代理的地址；headers 是线路自带的请求头（转成 ua / referer 参数）。 */
export function streamUrl(source: string, headers?: StreamHeaders): string {
  const url = new URL(source)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('播放地址必须是无凭据的 HTTP(S) URL')
  return `${STREAM_SCHEME}://fetch/?src=${encodeURIComponent(url.href)}${streamHeaderQuery(headers)}`
}
