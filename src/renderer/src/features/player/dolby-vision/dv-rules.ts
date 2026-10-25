/**
 * 杜比视界播放的渲染层规则（纯函数）：选输出、把主进程结果翻成播放计划、做不了时怎么退、界面文案。
 * 要不要重建用 shared/video-range 的 needsDvColorFix（与打开播放器时的 mpv 路由同一条判定）。
 */
import type {
  DvOutput,
  DvStartResult,
} from '../../../../../shared/dolby-vision'

/** 识别超过这么久才在播放区显示「正在识别视频…」（本地盘通常几十毫秒，不闪） */
export const DV_PROBE_FEEDBACK_MS = 300
/** 识别较慢时在播放区显示的文字 */
export const DV_PROBING_TEXT = '正在识别视频…'
/** 准备阶段在播放区显示的文字 */
export const DV_PREPARING_TEXT = '正在准备杜比视界…'
/** 转到 mpv 后播放区显示的文字 */
export const DV_HANDED_OFF_TEXT = '已在 mpv 中播放杜比视界'
/** 没能重建、也没交给 mpv 时的提示（只好直接播，色彩会偏） */
export const DV_DIRECT_WARNING = '杜比视界无法在应用内重建，画面颜色可能不正确'
/** 重建会话播放中出错时的原因（随后按 dvFallback 退到 mpv 或直接播） */
export const DV_RUNTIME_FAILURE = '杜比视界重建播放中断'
/** 主进程表示这次开播已被更新的开播取代 */
export const DV_SUPERSEDED = 'superseded'

/** 浏览器端能力：显示器是否 HDR、能否解 HEVC Main10。 */
export interface DisplayCaps {
  hdrDisplay: boolean
  hevcMain10: boolean
}

/**
 * 重建输出：HDR 显示器且能解 HEVC Main10 → HDR10；否则色调映射到 SDR（H.264 哪都能解）。
 */
export function chooseOutput(caps: DisplayCaps): DvOutput {
  return caps.hdrDisplay && caps.hevcMain10 ? 'hdr10' : 'sdr'
}

/** 主进程开播结果翻成的计划：拿到地址就应用内播，否则带原因回退。 */
export type StartPlan =
  | { kind: 'stream'; id: string; url: string }
  | { kind: 'fallback'; reason: string }

/** 主进程开播结果 → 播放计划。 */
export function planFromStart(result: DvStartResult): StartPlan {
  return result.kind === 'stream'
    ? { kind: 'stream', id: result.id, url: result.url }
    : { kind: 'fallback', reason: result.reason }
}

/**
 * 应用内重建做不了（开播前或播放中）时怎么退：
 * 设置「杜比视界 P5 自动用 mpv」开着且有 mpv 桥 → 试 mpv；否则直接播并提示色彩可能不对。
 */
export function dvFallback(context: {
  autoMpv: boolean
  mpvBridge: boolean
}): 'mpv' | 'direct' {
  return context.autoMpv && context.mpvBridge ? 'mpv' : 'direct'
}

/**
 * 重建会话的本机地址前缀（http://127.0.0.1:端口/令牌/）：桌面 HLS 加载器对它直连，不走公网代理。
 * 不是本机回环地址返回空串。
 */
export function localStreamPrefix(url: string): string {
  if (!url.startsWith('http://127.0.0.1:')) return ''
  return url.slice(0, url.lastIndexOf('/') + 1)
}
