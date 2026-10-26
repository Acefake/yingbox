/**
 * 播放失败的原因文案（纯函数）：把 hls.js 的致命错误与 <video> 的 MediaError 翻成一句用户看得懂的话。
 * 播放器经 error 事件（CustomEvent.detail）把它交给外层，直播页据此显示每条线路为什么失败。
 */
import { httpStatusText } from '../../../../../shared/iptv/stream-kind'

/** hls.js 错误数据里用到的字段 */
export interface HlsErrorLike {
  details?: string
  response?: { code?: number }
}

/** 编码 / 容器不受支持类的错误：换 mpv 通常能播 */
const CODEC_DETAILS = new Set([
  'manifestIncompatibleCodecsError',
  'bufferAddCodecError',
  'bufferIncompatibleCodecsError',
  'bufferAppendError',
  'fragParsingError',
  'fragDecryptError',
])

/** 超时类 */
const TIMEOUT_DETAILS = new Set([
  'manifestLoadTimeOut',
  'levelLoadTimeOut',
  'fragLoadTimeOut',
  'audioTrackLoadTimeOut',
  'keyLoadTimeOut',
])

/** 加载类（带 HTTP 状态码） */
const LOAD_DETAILS = new Set([
  'manifestLoadError',
  'levelLoadError',
  'fragLoadError',
  'audioTrackLoadError',
  'keyLoadError',
])

/** 编码不受支持的统一文案 */
export const CODEC_UNSUPPORTED =
  '编码不受支持（常见于 HEVC 画面或 MP2 / AC3 音频）'

/** hls.js 致命错误的原因 */
export function hlsErrorReason(data: HlsErrorLike): string {
  const details = data.details ?? ''
  if (TIMEOUT_DETAILS.has(details)) return '连接超时'
  if (LOAD_DETAILS.has(details)) {
    const code = data.response?.code ?? 0
    return code > 0 ? httpStatusText(code) : '网络错误，连不上服务器'
  }
  if (details === 'manifestParsingError' || details === 'levelEmptyError')
    return '返回的不是有效的 HLS 清单'
  if (CODEC_DETAILS.has(details)) return CODEC_UNSUPPORTED
  return details ? `播放出错（${details}）` : '播放出错'
}

/**
 * <video> 的 MediaError 原因。
 * @param code MediaError.code（1 中止、2 网络、3 解码、4 格式不支持）
 */
export function videoErrorReason(code: number | undefined): string {
  if (code === 2) return '网络错误，连不上服务器'
  if (code === 3) return CODEC_UNSUPPORTED
  if (code === 4) return '格式不受支持'
  return '播放出错'
}
