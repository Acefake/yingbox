/**
 * 直播流格式判定（纯函数，主进程探测与渲染层共用）：
 * 按地址协议、响应头 Content-Type 与响应体开头的几个字节，判断一条直播线路是 HLS 清单、
 * MP4 / WebM 文件、FLV / MPEG-TS 连续流，还是网页 / 错误页，并给出内置播放器能否播放。
 *
 * 内置播放器是 Chromium + hls.js：只能播 HLS 与 MP4 / WebM；FLV、裸 TS、RTMP / RTP / UDP 组播交给 mpv。
 */

/** 直播流格式 */
export type StreamKind =
  | 'hls'
  | 'mp4'
  | 'webm'
  | 'audio'
  | 'flv'
  | 'mpegts'
  | 'dash'
  | 'html'
  | 'unknown'

/** 浏览器打不开、只能交给外部播放器的直播协议 */
const EXTERNAL_SCHEMES = new Set([
  'rtmp:',
  'rtmps:',
  'rtsp:',
  'rtp:',
  'udp:',
  'mms:',
  'mmsh:',
  'p3p:',
  'p2p:',
])

/**
 * 地址的协议是不是只有外部播放器能播（rtmp / rtsp / rtp / udp 组播等）。
 * @param url 线路地址
 */
export function isExternalOnlyUrl(url: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*:)/i.exec(url.trim())
  return Boolean(match && EXTERNAL_SCHEMES.has(match[1].toLowerCase()))
}

/** udpxy 一类的组播转单播网关（http://网关/rtp/239.x.x.x:端口），返回的是连续 MPEG-TS */
export function isMulticastRelayUrl(url: string): boolean {
  return /^https?:\/\/[^/]+\/(rtp|udp)\/\d{1,3}(\.\d{1,3}){3}:\d+/i.test(
    url.trim()
  )
}

const startsWith = (head: Uint8Array, bytes: number[], at = 0): boolean =>
  head.length >= at + bytes.length && bytes.every((b, i) => head[at + i] === b)

/** 去掉 UTF-8 BOM 与开头空白后的前若干字符（小写） */
function leadingText(head: Uint8Array, length = 64): string {
  let start = 0
  if (startsWith(head, [0xef, 0xbb, 0xbf])) start = 3
  const slice = head.subarray(start, start + 512)
  let text = ''
  for (const byte of slice) text += String.fromCharCode(byte)
  return text.trimStart().slice(0, length).toLowerCase()
}

/** 按字节特征判断（不看响应头）；认不出返回 null */
export function sniffBytes(head: Uint8Array): StreamKind | null {
  if (!head.length) return null
  const text = leadingText(head)
  if (text.startsWith('#extm3u')) return 'hls'
  if (startsWith(head, [0x46, 0x4c, 0x56])) return 'flv'
  // MPEG-TS：每 188 字节一个 0x47 同步字节，看前两个包
  if (head[0] === 0x47 && (head.length < 189 || head[188] === 0x47))
    return 'mpegts'
  if (startsWith(head, [0x66, 0x74, 0x79, 0x70], 4)) return 'mp4'
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm'
  if (
    startsWith(head, [0x49, 0x44, 0x33]) ||
    (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
  )
    return 'audio'
  if (text.startsWith('<?xml') && text.includes('<mpd')) return 'dash'
  if (text.startsWith('<mpd')) return 'dash'
  if (
    text.startsWith('<!doctype') ||
    text.startsWith('<html') ||
    text.startsWith('<head') ||
    text.startsWith('<body') ||
    text.startsWith('{') ||
    text.startsWith('<?xml')
  )
    return 'html'
  return null
}

/** 只按 Content-Type 判断；认不出返回 null */
export function kindFromContentType(contentType: string): StreamKind | null {
  const type = contentType.split(';')[0].trim().toLowerCase()
  if (!type) return null
  if (/mpegurl/.test(type)) return 'hls'
  if (type === 'video/x-flv' || type === 'video/flv') return 'flv'
  if (type === 'video/mp2t' || type === 'video/mpeg') return 'mpegts'
  if (type === 'video/mp4' || type === 'video/quicktime') return 'mp4'
  if (type === 'video/webm') return 'webm'
  if (type === 'application/dash+xml') return 'dash'
  if (type.startsWith('audio/')) return 'audio'
  if (type === 'text/html' || type === 'application/json') return 'html'
  return null
}

/** 只按地址扩展名判断；认不出返回 null */
export function kindFromUrl(url: string): StreamKind | null {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    // 非标准地址：按原串判断
  }
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  if (!ext) return isMulticastRelayUrl(url) ? 'mpegts' : null
  if (ext === 'm3u8' || ext === 'm3u') return 'hls'
  if (ext === 'flv') return 'flv'
  if (ext === 'ts') return 'mpegts'
  if (ext === 'mp4' || ext === 'm4v' || ext === 'mov') return 'mp4'
  if (ext === 'webm') return 'webm'
  if (ext === 'mpd') return 'dash'
  if (ext === 'mp3' || ext === 'aac' || ext === 'm4a') return 'audio'
  return null
}

/**
 * 综合判断：响应体字节优先（服务器的 Content-Type 常常写错，如 m3u8 回 text/plain、
 * FLV 回 application/octet-stream），其次 Content-Type，最后最终地址的扩展名。
 */
export function detectStreamKind(input: {
  head: Uint8Array
  contentType: string
  url: string
}): StreamKind {
  return (
    sniffBytes(input.head) ??
    kindFromContentType(input.contentType) ??
    kindFromUrl(input.url) ??
    'unknown'
  )
}

/** 内置播放器怎么播：hls 走 hls.js，video 走 <video> 直连，external 只能交给 mpv */
export type StreamPlayback = 'hls' | 'video' | 'external' | 'none'

/** 某种格式在内置播放器里的播法 */
export function playbackFor(kind: StreamKind): StreamPlayback {
  switch (kind) {
    case 'hls':
      return 'hls'
    case 'mp4':
    case 'webm':
    case 'audio':
      return 'video'
    case 'flv':
    case 'mpegts':
    case 'dash':
      return 'external'
    case 'html':
      return 'none'
    default:
      // 认不出来的按 HLS 试一次（很多接口地址不带扩展名，响应体也可能被压缩 / 分块）
      return 'hls'
  }
}

/** 格式的显示名 */
export function streamKindLabel(kind: StreamKind): string {
  const labels: Record<StreamKind, string> = {
    hls: 'HLS',
    mp4: 'MP4',
    webm: 'WebM',
    audio: '音频流',
    flv: 'FLV 直播流',
    mpegts: 'MPEG-TS 直播流',
    dash: 'DASH',
    html: '网页',
    unknown: '未知格式',
  }
  return labels[kind]
}

/**
 * 拉流时 HTTP 状态码的说明（探测与播放器共用一套措辞）。
 * @param code 状态码；504 是本地播放代理等上游响应头超时
 */
export function httpStatusText(code: number): string {
  if (code === 504) return '连接超时'
  if (code === 403)
    return '服务器拒绝访问（HTTP 403，可能限制了地区或需要令牌）'
  if (code === 404 || code === 410) return `线路已失效（HTTP ${code}）`
  if (code >= 500) return `服务器出错（HTTP ${code}）`
  return `服务器返回 HTTP ${code}`
}
