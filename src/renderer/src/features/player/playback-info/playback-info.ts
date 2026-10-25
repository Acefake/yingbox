/**
 * 播放信息面板：设置菜单或右键「播放信息」打开播放器左上角的浮层，每秒刷新一次。
 * 浮层是 Artplayer 的 layer（在播放器节点里，全屏时也可见）；行内容由 info-rules.ts 生成。
 */
import type Artplayer from 'artplayer'
import type Hls from 'hls.js'

import { artIcon } from '../utils/art-options'
import {
  type HlsInfo,
  type InfoSample,
  estimateBitrate,
  infoRows,
} from './info-rules'
import './playback-info.css'

/** layer / 设置项 / 右键菜单项的名字 */
const NAME = 'ybPlaybackInfo'
const REFRESH_MS = 1000

/** Chromium 的已解码字节计数（非标准属性，没有类型声明） */
interface DecodedCounters {
  webkitVideoDecodedByteCount?: number
  webkitAudioDecodedByteCount?: number
}

/** <video> 已解码的字节数；浏览器不提供时为 undefined */
function decodedBytes(video: HTMLVideoElement): number | undefined {
  const v = video as HTMLVideoElement & DecodedCounters
  if (typeof v.webkitVideoDecodedByteCount !== 'number') return undefined
  return v.webkitVideoDecodedByteCount + (v.webkitAudioDecodedByteCount ?? 0)
}

/** hls.js 实例的当前状态 */
function hlsInfo(hls: Hls): HlsInfo {
  return {
    levels: hls.levels.map(level => ({
      width: level.width,
      height: level.height,
      bitrate: level.bitrate,
      videoCodec: level.videoCodec,
      audioCodec: level.audioCodec,
    })),
    current: hls.currentLevel,
    auto: hls.autoLevelEnabled,
    bandwidth: hls.bandwidthEstimate,
  }
}

/** 一次采样（码率由调用方按前后两次字节数补上） */
function sample(art: Artplayer, hls: Hls | null): InfoSample {
  const video = art.video
  const buffered: Array<[number, number]> = []
  for (let i = 0; i < video.buffered.length; i++) {
    buffered.push([video.buffered.start(i), video.buffered.end(i)])
  }
  const q = video.getVideoPlaybackQuality?.()
  return {
    url: art.url,
    width: video.videoWidth,
    height: video.videoHeight,
    currentTime: video.currentTime,
    buffered,
    quality: q
      ? { dropped: q.droppedVideoFrames, total: q.totalVideoFrames }
      : undefined,
    hls: hls ? hlsInfo(hls) : undefined,
  }
}

/** 把行写进浮层（只用 textContent，不拼 HTML） */
function render(list: HTMLElement, rows: ReturnType<typeof infoRows>): void {
  list.replaceChildren(
    ...rows.flatMap(row => {
      const dt = document.createElement('dt')
      dt.textContent = row.label
      const dd = document.createElement('dd')
      dd.textContent = row.value
      return [dt, dd]
    })
  )
}

/** 每个实例的「收起播放信息」（缩进小窗时由外层调用） */
const closers = new WeakMap<Artplayer, () => void>()

/**
 * 收起某个实例的播放信息浮层（停掉刷新计时）；没装过或已收起时什么也不做。
 * @param art Artplayer 实例
 */
export function closePlaybackInfo(art: Artplayer): void {
  closers.get(art)?.()
}

/**
 * 给一个播放器实例装上「播放信息」（设置菜单项、右键菜单项与浮层）。实例销毁时自动拆除。
 * @param art Artplayer 实例
 * @param hls 当前的 hls.js 实例（非 HLS 为 null）
 * @param compact 是否缩在角落小窗：小窗里放不下，不打开，只给一句提示
 */
export function installPlaybackInfo(
  art: Artplayer,
  hls: () => Hls | null,
  compact: () => boolean = () => false
): void {
  const layer = art.layers.add({
    name: NAME,
    html: `<div class="yb-info__head"><span class="yb-info__title">播放信息</span><span class="yb-info__close" role="button" tabindex="0" aria-label="关闭播放信息">${artIcon('close')}</span></div><dl class="yb-info__list"></dl>`,
  })
  if (!layer) return
  layer.classList.add('yb-info')
  const list = layer.querySelector<HTMLElement>('.yb-info__list')
  const close = layer.querySelector<HTMLElement>('.yb-info__close')

  let timer: number | undefined
  let prev: { bytes: number; at: number } | null = null

  const refresh = (): void => {
    if (!list) return
    const s = sample(art, hls())
    const bytes = decodedBytes(art.video)
    const now = performance.now()
    if (bytes !== undefined) {
      if (prev) s.bitrate = estimateBitrate(prev.bytes, bytes, now - prev.at)
      prev = { bytes, at: now }
    }
    render(list, infoRows(s))
  }

  const setOpen = (open: boolean): void => {
    if (open && compact()) {
      art.notice.show = '展开播放器后再打开'
      return
    }
    layer.classList.toggle('is-open', open)
    window.clearInterval(timer)
    timer = undefined
    prev = null
    if (!open) return
    refresh()
    timer = window.setInterval(refresh, REFRESH_MS)
  }
  const toggle = (): void => setOpen(!layer.classList.contains('is-open'))

  closers.set(art, () => setOpen(false))
  close?.addEventListener('click', () => setOpen(false))
  close?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') setOpen(false)
  })
  // 浮层上的点击不冒泡到播放器（否则会切换播放 / 暂停）
  layer.addEventListener('click', event => event.stopPropagation())

  art.setting.add({
    name: NAME,
    html: '播放信息',
    icon: artIcon('info'),
    onClick() {
      toggle()
      art.setting.show = false
      return ''
    },
  })
  art.contextmenu.add({
    name: NAME,
    html: '播放信息',
    click() {
      toggle()
      art.contextmenu.show = false
    },
  })
  art.on('destroy', () => window.clearInterval(timer))
}
