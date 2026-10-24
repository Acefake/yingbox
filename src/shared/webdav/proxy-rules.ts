/**
 * 远程媒体播放代理的转发规则（纯函数）：主进程的 yingbox-dav 协议（内置播放器）和
 * 本机 HTTP 代理（mpv）共用。
 *
 * - 只转发 GET / HEAD；
 * - 请求头只带 Range / If-Range（拖进度条要的）和凭据，不转发播放器的 Cookie、Referer 等；
 * - 响应头只回媒体相关的几项，去掉 WWW-Authenticate（否则 Chromium 会弹登录框）与 Set-Cookie；
 * - 上游认证失败、连不上回 502，不把上游的错误页（可能带服务器信息）交给播放器；
 *   200 / 206 / 304 / 416 原样回（416 带 Content-Range，播放器据此知道文件大小）。
 */

/** 允许的方法。 */
export const PROXY_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD'])

/** 转发给上游的请求头（小写）。 */
const FORWARD_REQUEST = ['range', 'if-range'] as const

/** 回给播放器的响应头（小写）。 */
const FORWARD_RESPONSE = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
] as const

/** 头的最小读接口（Headers 与 Node IncomingHttpHeaders 都能适配）。 */
export type HeaderGet = (name: string) => string | null | undefined

/** 上游请求头：Range / If-Range + 认证。Range 格式不合法时丢掉（按整文件请求）。 */
export function upstreamHeaders(
  get: HeaderGet,
  auth: string | undefined
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const name of FORWARD_REQUEST) {
    const value = get(name)
    if (!value) continue
    if (name === 'range' && !/^bytes=\d*-\d*(,\s*\d*-\d*)*$/.test(value))
      continue
    headers[name === 'range' ? 'Range' : 'If-Range'] = value
  }
  if (auth) headers.Authorization = auth
  return headers
}

/** 上游状态 → 回给播放器的状态。 */
export function proxyStatus(upstream: number): number {
  if ([200, 206, 304, 416].includes(upstream)) return upstream
  if (upstream === 404) return 404
  return 502
}

/** 回给播放器的响应头；mime 为按扩展名推断的类型，上游没给 Content-Type 或给的是通用类型时用它。 */
export function downstreamHeaders(
  get: HeaderGet,
  mime: string | undefined
): Record<string, string> {
  const headers: Record<string, string> = { 'Cache-Control': 'no-cache' }
  for (const name of FORWARD_RESPONSE) {
    const value = get(name)
    if (value) headers[name] = value
  }
  const type = headers['content-type']
  if (mime && (!type || /^(application\/octet-stream|binary\/)/i.test(type)))
    headers['content-type'] = mime
  return headers
}
