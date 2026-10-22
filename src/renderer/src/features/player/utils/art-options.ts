/**
 * Artplayer 的配置与播放规则：控制栏图标、主题色、构造参数，以及续播位置、倍速、HLS 判定这几条纯规则。
 * 与组件状态无关，UnifiedVideoPlayer 只负责生命周期和事件。
 */
import type Artplayer from 'artplayer'

import { ICON_PATHS, type IconName } from '@/components/ui/icons'

/** Artplayer 构造参数 */
export type ArtOption = ConstructorParameters<typeof Artplayer>[0]

/**
 * 播放器控件主题色取自 tokens.css 的 --media-accent（Artplayer 需要具体颜色值，不能传 var()）。
 */
function mediaAccent(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue('--media-accent')
      .trim() || 'white'
  )
}

/**
 * 把设计系统的图标转成 Artplayer 控制栏可用的 SVG 字符串，
 * 让播放器原生控制栏与应用其余部分使用同一套线性图标。
 * 只替换图标外观，不改变 Artplayer 的任何控制行为。
 */
const artIcon = (name: IconName, filled = false): string =>
  `<svg viewBox="0 0 24 24" width="22" height="22" style="fill:${
    filled ? 'currentColor' : 'none'
  }" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`

/** 替换 Artplayer 默认图标 */
export const ART_ICONS = {
  play: artIcon('play', true),
  pause: artIcon('pause'),
  volume: artIcon('volume'),
  volumeClose: artIcon('volumeOff'),
  fullscreenOn: artIcon('fullscreen'),
  // 图标库没有「退出全屏」，用最接近的 restore
  fullscreenOff: artIcon('restore'),
  pip: artIcon('pip'),
  setting: artIcon('settings'),
}

/** 系统画中画可用（document.pictureInPictureEnabled）：可用时才显示画中画按钮 */
export const pipSupported = (): boolean =>
  typeof document !== 'undefined' && document.pictureInPictureEnabled === true

/** 地址是否为 HLS（.m3u8，可带查询串） */
export const isHlsUrl = (url: string): boolean => /\.m3u8(?:$|\?)/i.test(url)

/**
 * 是否跳到续播位置：只续播 5 秒以后、离结尾超过 10 秒的位置，太短（≤15 秒）或时长未知的视频不续播。
 * @param target 续播秒数
 * @param duration 视频总时长（秒）
 */
export function shouldResume(target: number, duration: number): boolean {
  if (!(target > 5)) return false
  if (!Number.isFinite(duration) || duration <= 15) return false
  return target < duration - 10
}

/** 倍速是否值得记住（0.25–4 之间的有限数） */
export const isValidPlaybackRate = (rate: number): boolean =>
  Number.isFinite(rate) && rate >= 0.25 && rate <= 4

/**
 * 把倍速同时设到 defaultPlaybackRate 与 playbackRate（video.load() 会把后者重置为前者，
 * 这样自动连播换集后倍速不丢）。1 倍速不处理。
 */
export function applyPlaybackRate(
  el: HTMLVideoElement | null | undefined,
  rate: number
): void {
  if (!el || rate === 1) return
  try {
    el.defaultPlaybackRate = rate
    if (el.playbackRate !== rate) el.playbackRate = rate
  } catch {
    // ignore
  }
}

/** artOptions 的输入 */
export interface ArtOptionsInput {
  container: HTMLDivElement
  url: string
  autoplay: boolean
  /** 显示全屏等控制 */
  controls: boolean
  /** HLS 自定义加载器（hls.js）；非 HLS 传 null */
  hls: ArtOption['customType'] | null
}

/** 生成 Artplayer 构造参数（播放器的固定外观与行为都在这里） */
export function artOptions(input: ArtOptionsInput): ArtOption {
  return {
    container: input.container,
    url: input.url,
    poster: '',
    theme: mediaAccent(),
    volume: 1,
    autoplay: input.autoplay,
    muted: false,
    autoSize: false,
    autoMini: false,
    loop: false,
    flip: false,
    playbackRate: true,
    aspectRatio: false,
    screenshot: false,
    setting: true,
    hotkey: false,
    // 画中画用 Artplayer 自带控件（内部即 video.requestPictureInPicture）
    pip: pipSupported(),
    mutex: true,
    backdrop: true,
    fullscreen: input.controls,
    fullscreenWeb: false,
    miniProgressBar: false,
    autoPlayback: false,
    lock: false,
    fastForward: false,
    autoOrientation: false,
    lang: 'zh-cn',
    icons: ART_ICONS,
    moreVideoAttr: {
      playsInline: true,
      preload: 'auto',
    },
    // Artplayer 5.x 校验 option.type 必须是字符串：传 undefined 会在构造时抛错，
    // 导致非 HLS（本地文件、直链 mp4/flv）根本无法创建播放器。空串即沿用
    // Artplayer 默认的按扩展名自动识别。
    ...(input.hls ? { type: 'm3u8', customType: input.hls } : {}),
  }
}
