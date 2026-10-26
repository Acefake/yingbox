/**
 * 一条直播线路怎么播（纯函数）：根据主进程的探测结果（shared/iptv/stream-kind.ts 判格式）决定
 * 走 hls.js、经播放代理的 <video> 直连，还是只能交给 mpv；失败时给出具体原因文案。
 *
 * HLS 交给 hls.js，清单与分片由桌面加载器经 yingbox-stream:// 代理（解决 IPTV 源没有 CORS 头、只有 http、
 * 需要 Referer 的问题）；MP4 / WebM 同样经代理地址交给 <video>。
 * 线路地址可带 `|User-Agent=…&Referer=…`（频道自带的头）：hls 与网页端原样交给播放器（hls-session / webPlayableUrl
 * 拆开后带给代理），video 直接换成带 ua / referer 参数的代理地址。
 */
import {
  type StreamKind,
  httpStatusText,
  isExternalOnlyUrl,
  playbackFor,
  streamKindLabel,
} from '../../../../../shared/iptv/stream-kind'
import type { StreamProbe } from '../../../../../shared/contract/iptv'
import {
  type StreamHeaders,
  splitStreamHeaders,
} from '../../../../../shared/net/stream-headers'
import { streamUrl } from '../../../../../shared/stream-url'
import { isLikelyHls } from './live-rules'

/** 线路的播放方案 */
export interface LinePlan {
  /** hls：hls.js；video：<video> 直连；external：内置播放器播不了（可交给 mpv）；fail：线路不通 */
  mode: 'hls' | 'video' | 'external' | 'fail'
  /**
   * 交给播放器的地址：hls 用原地址（含请求头后缀），由加载器代理；有探测结果（桌面）时 video 用代理地址；
   * 没有探测能力（网页端）时原样（含后缀），由 art-core 的 webPlayableUrl 拆开、换成服务端代理地址。
   */
  src: string
  /** 失败 / 不支持的原因 */
  reason: string
  kind?: StreamKind
}

/** 地址是不是 IPv6 字面量主机（http://[2409:…]/） */
export const isIpv6Url = (url: string): boolean =>
  /^[a-z]+:\/\/\[[0-9a-f:.]+\]/i.test(url.trim())

/** Chromium 网络错误码的说明 */
const NET_ERRORS: Array<[RegExp, string]> = [
  [/ERR_NAME_NOT_RESOLVED|无法解析主机/, '域名解析失败'],
  [/ERR_CONNECTION_REFUSED/, '连接被拒绝'],
  [/ERR_(ADDRESS|NETWORK)_UNREACHABLE|ERR_INTERNET_DISCONNECTED/, '网络不可达'],
  [/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/, '连接超时'],
  [/ERR_CONNECTION_(RESET|CLOSED)|ERR_EMPTY_RESPONSE/, '连接被重置'],
  [/ERR_CERT_|ERR_SSL_/, 'HTTPS 证书无效'],
  [/ERR_UNSAFE_PORT/, '端口被浏览器禁止'],
]

/** 网络错误原文 → 说明 */
export function netErrorText(error: string): string {
  for (const [re, text] of NET_ERRORS) if (re.test(error)) return text
  return error ? `网络错误（${error}）` : '网络错误'
}

/** 探测失败的原因文案；IPv6 线路连不上时补一句提示 */
export function probeFailureText(url: string, probe: StreamProbe): string {
  let text: string
  switch (probe.failure) {
    case 'timeout':
      text = '连接超时'
      break
    case 'http':
      text = httpStatusText(probe.status ?? 0)
      break
    case 'blocked':
      text = '内网地址不能在内置播放器打开'
      break
    default:
      text = netErrorText(probe.error ?? '')
  }
  if (isIpv6Url(url) && probe.failure !== 'http')
    text += '（IPv6 线路，需要本机有 IPv6 网络）'
  return text
}

/** 经播放代理的地址；地址不合规（带账号密码等）时原样返回 */
function proxied(url: string, headers?: StreamHeaders): string {
  try {
    return streamUrl(url, headers)
  } catch {
    return url
  }
}

/**
 * 决定一条线路的播法。
 * @param line 线路地址（可带请求头后缀）
 * @param probe 主进程探测结果；null 表示没有探测能力（按地址扩展名猜）
 */
export function planLine(line: string, probe: StreamProbe | null): LinePlan {
  const { url, headers } = splitStreamHeaders(line)
  if (isExternalOnlyUrl(url))
    return {
      mode: 'external',
      src: url,
      reason: '组播 / RTMP 等协议，内置播放器不支持',
    }
  if (!probe)
    return { mode: isLikelyHls(url) ? 'hls' : 'video', src: line, reason: '' }
  if (!probe.ok)
    return { mode: 'fail', src: url, reason: probeFailureText(url, probe) }
  const kind = probe.kind ?? 'unknown'
  switch (playbackFor(kind)) {
    case 'hls':
      return { mode: 'hls', src: line, reason: '', kind }
    case 'video':
      return { mode: 'video', src: proxied(url, headers), reason: '', kind }
    case 'external':
      return {
        mode: 'external',
        src: url,
        reason: `${streamKindLabel(kind)}，内置播放器不支持`,
        kind,
      }
    default:
      return {
        mode: 'fail',
        src: url,
        reason: '返回的是网页而不是视频（线路可能已失效）',
        kind,
      }
  }
}

/** 全部线路失败后的说明：每条线路一句，最多列 4 条 */
export function failureSummary(
  reasons: readonly (string | undefined)[]
): string {
  const lines = reasons
    .map((reason, index) => (reason ? `线路 ${index + 1}：${reason}` : ''))
    .filter(Boolean)
  if (!lines.length) return '稍后重试，或在直播源里换一个播放列表'
  const shown = lines.slice(0, 4).join('；')
  return lines.length > 4 ? `${shown}；等 ${lines.length} 条` : shown
}
