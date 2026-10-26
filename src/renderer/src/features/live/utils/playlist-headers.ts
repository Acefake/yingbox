/**
 * m3u 里按频道写的请求头（纯函数）：解析出 User-Agent / Referer，挂到线路地址上（`地址|User-Agent=…`，
 * 规范写法见 shared/net/stream-headers），再由探测、播放代理、mpv 各自拆开使用。
 *
 * 认这几种常见写法（同一频道多处都写了时，优先级：地址后缀 > 指令行 > #EXTINF 属性）：
 * - `#EXTVLCOPT:http-user-agent=…` / `#EXTVLCOPT:http-referrer=…`（VLC）；
 * - `#KODIPROP:inputstream.adaptive.stream_headers=User-Agent=…&Referer=…`（Kodi，manifest_headers 同理）；
 * - `#EXTHTTP:{"User-Agent":"…","Referer":"…"}`（TiviMate 等）；
 * - `#EXTINF` 上的 `http-user-agent="…"` / `http-referrer="…"` 属性；
 * - 地址末尾的 `|User-Agent=…&Referer=…`（Kodi）。
 * 只取这两个头，其余（Cookie、DRM 授权等）忽略。
 */
import {
  type StreamHeaders,
  headerField,
  joinStreamHeaders,
  parseHeaderPairs,
  sanitizeStreamHeaders,
  splitStreamHeaders,
} from '../../../../../shared/net/stream-headers'

/** 合并多份请求头：后面的覆盖前面的（只覆盖有值的字段） */
export function mergeHeaders(
  ...list: Array<StreamHeaders | undefined>
): StreamHeaders | undefined {
  const out: StreamHeaders = {}
  for (const headers of list) if (headers) Object.assign(out, headers)
  return sanitizeStreamHeaders(out)
}

/** #EXTINF 属性里的请求头 */
export function headersFromAttrs(
  attrs: Record<string, string>
): StreamHeaders | undefined {
  const out: StreamHeaders = {}
  for (const [name, value] of Object.entries(attrs)) {
    const field = headerField(name)
    if (field) out[field] = value
  }
  return sanitizeStreamHeaders(out)
}

/** #EXTHTTP 的 JSON 对象 */
function headersFromJson(raw: string): StreamHeaders | undefined {
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object') return undefined
    return headersFromAttrs(
      Object.fromEntries(
        Object.entries(data).filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>
    )
  } catch {
    return undefined
  }
}

/** 一行指令里的请求头；不是请求头指令返回 undefined */
export function headersFromDirective(line: string): StreamHeaders | undefined {
  const vlc = /^#EXTVLCOPT:\s*([\w-]+)\s*=(.*)$/i.exec(line)
  if (vlc) {
    const field = headerField(vlc[1])
    return field ? sanitizeStreamHeaders({ [field]: vlc[2] }) : undefined
  }
  const kodi =
    /^#KODIPROP:\s*inputstream\.adaptive\.(?:stream|manifest)_headers\s*=(.*)$/i.exec(
      line
    )
  if (kodi) return parseHeaderPairs(kodi[1].trim())
  const http = /^#EXTHTTP:(.*)$/i.exec(line)
  if (http) return headersFromJson(http[1].trim())
  return undefined
}

/**
 * 一条地址行 → 线路地址：去掉 `$备注`（与 txt 一致），拆出 `|头` 后缀，和频道上写的头合并后按规范写法挂回。
 * @param line 地址行原文
 * @param inherited 指令行 / #EXTINF 属性给出的头（地址后缀优先）
 */
export function lineUrl(line: string, inherited?: StreamHeaders): string {
  const { url, headers } = splitStreamHeaders(line.split('$')[0])
  return joinStreamHeaders(url, mergeHeaders(inherited, headers))
}
