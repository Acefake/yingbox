/**
 * 直播线路自带的请求头（User-Agent / Referer）：怎么挂在地址上、怎么传给播放代理。
 *
 * - 线路地址内部统一用 Kodi 写法携带：`地址|User-Agent=…&Referer=…`（值 encodeURIComponent）。
 *   播放列表解析、探测、mpv、播放器之间都只传这一个字符串，各自用 {@link splitStreamHeaders} 拆开；
 * - 交给播放代理时用查询参数 `ua` / `referer`（桌面 yingbox-stream://fetch/、服务端 /api/stream 相同），
 *   代理据此发请求；m3u8 改写时分片地址带上同样的参数；
 * - 只认这两个头：不许借此注入 Cookie / Authorization / Host 等；去掉控制字符、限长，Referer 必须是 http(s) 地址。
 *   SSRF 校验只看目标地址，不受这里影响。
 */

/** 线路请求头 */
export interface StreamHeaders {
  userAgent?: string
  referer?: string
}

/** 单个值的长度上限 */
const MAX_VALUE = 1024
/** 代理查询参数名 */
export const STREAM_UA_PARAM = 'ua'
export const STREAM_REFERER_PARAM = 'referer'

/** 去控制字符、首尾空白并限长；空串为 undefined */
function cleanValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return text ? text.slice(0, MAX_VALUE) : undefined
}

/** 校验并收窄；两个都没有时返回 undefined */
export function sanitizeStreamHeaders(
  input: StreamHeaders | null | undefined
): StreamHeaders | undefined {
  if (!input) return undefined
  const userAgent = cleanValue(input.userAgent)
  let referer = cleanValue(input.referer)
  if (referer && !/^https?:\/\/\S+$/i.test(referer)) referer = undefined
  if (!userAgent && !referer) return undefined
  return {
    ...(userAgent ? { userAgent } : {}),
    ...(referer ? { referer } : {}),
  }
}

/** 头名 → 字段（大小写不敏感；Referrer 拼写也认） */
export function headerField(name: string): keyof StreamHeaders | null {
  const key = name.trim().toLowerCase()
  if (key === 'user-agent' || key === 'http-user-agent') return 'userAgent'
  if (['referer', 'referrer', 'http-referer', 'http-referrer'].includes(key))
    return 'referer'
  return null
}

/** 解码一个值；不是合法的百分号编码时原样返回 */
function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, '%20'))
  } catch {
    return value
  }
}

/** 解析 `User-Agent=…&Referer=…`（Kodi 管道后缀 / KODIPROP stream_headers）；不认识的头忽略 */
export function parseHeaderPairs(raw: string): StreamHeaders | undefined {
  const headers: StreamHeaders = {}
  for (const pair of raw.split('&')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const field = headerField(decode(pair.slice(0, eq)))
    if (field) headers[field] = decode(pair.slice(eq + 1))
  }
  return sanitizeStreamHeaders(headers)
}

/**
 * 拆开 `地址|头=值&…`：`|` 后面像头参数（`名=值`）就拆，不认识的头（Cookie 等）丢弃、只留地址；
 * `|` 后面不像头参数时不拆（当作地址本身的一部分）。
 */
export function splitStreamHeaders(value: string): {
  url: string
  headers?: StreamHeaders
} {
  const bar = value.indexOf('|')
  if (bar < 0 || !/^[\w-]+=/.test(value.slice(bar + 1)))
    return { url: value.trim() }
  const url = value.slice(0, bar).trim()
  const headers = parseHeaderPairs(value.slice(bar + 1))
  return headers ? { url, headers } : { url }
}

/** 把请求头挂回地址（规范写法，供合并去重）；没有头时原样返回 */
export function joinStreamHeaders(
  url: string,
  headers: StreamHeaders | undefined
): string {
  const clean = sanitizeStreamHeaders(headers)
  if (!clean) return url
  const pairs: string[] = []
  if (clean.userAgent)
    pairs.push(`User-Agent=${encodeURIComponent(clean.userAgent)}`)
  if (clean.referer) pairs.push(`Referer=${encodeURIComponent(clean.referer)}`)
  return `${url}|${pairs.join('&')}`
}

/** 代理地址的查询参数后缀（含前导 &）；没有头时为空串 */
export function streamHeaderQuery(headers: StreamHeaders | undefined): string {
  const clean = sanitizeStreamHeaders(headers)
  if (!clean) return ''
  let query = ''
  if (clean.userAgent)
    query += `&${STREAM_UA_PARAM}=${encodeURIComponent(clean.userAgent)}`
  if (clean.referer)
    query += `&${STREAM_REFERER_PARAM}=${encodeURIComponent(clean.referer)}`
  return query
}

/** 从代理地址的查询参数读回（同样校验） */
export function readStreamHeaderQuery(
  params: URLSearchParams
): StreamHeaders | undefined {
  return sanitizeStreamHeaders({
    userAgent: params.get(STREAM_UA_PARAM) ?? undefined,
    referer: params.get(STREAM_REFERER_PARAM) ?? undefined,
  })
}

/** 转成 fetch 的请求头 */
export function toRequestHeaders(
  headers: StreamHeaders | undefined
): Record<string, string> {
  const out: Record<string, string> = {}
  if (headers?.userAgent) out['User-Agent'] = headers.userAgent
  if (headers?.referer) out.Referer = headers.referer
  return out
}
