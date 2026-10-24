/**
 * 播放器控制栏皮肤：在 Artplayer 之上补三处交互，配合 styles/art-skin.css 做出简洁的控制栏。
 *   - 横向音量条：悬停展开，拖动时在圆点上方显示百分比（替代 Artplayer 自带的竖向音量弹层）
 *   - 字幕按钮（CC）：已挂字幕时切换显示，没有字幕时打开在线字幕搜索
 *   - 设置按钮右上角的清晰度角标（HD / 2K / 4K），按视频实际高度判断
 * 只加控件和样式，不改变播放行为。
 */
import type Artplayer from 'artplayer'

import { type ArtOption, artIcon } from './art-options'

/** Artplayer 自定义控件 */
type ArtControl = NonNullable<ArtOption['controls']>[number]

/**
 * 按视频高度给出清晰度角标；低于 720p 不显示。
 * @param height video.videoHeight
 */
export function qualityBadge(height: number): string {
  if (!Number.isFinite(height) || height < 720) return ''
  if (height >= 2160) return '4K'
  if (height >= 1440) return '2K'
  return 'HD'
}

/**
 * 音量百分比（0–100 的整数），静音按 0 算。
 * @param volume video.volume（0–1）
 * @param muted 是否静音
 */
export function volumePercent(volume: number, muted: boolean): number {
  if (muted || !Number.isFinite(volume)) return 0
  return Math.round(Math.min(1, Math.max(0, volume)) * 100)
}

/**
 * 指针在音量条上的位置换算成音量（0–1）。
 * @param clientX 指针横坐标
 * @param left 音量条左边缘
 * @param width 音量条宽度
 */
export function volumeAt(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0
  return Math.min(1, Math.max(0, (clientX - left) / width))
}

/** 横向音量条：图标点击静音，条上点击 / 拖动调音量 */
function volumeControl(): ArtControl {
  return {
    name: 'ybVolume',
    position: 'left',
    index: 20,
    html: `<span class="yb-volume__icon yb-volume__icon--on">${artIcon('volume')}</span><span class="yb-volume__icon yb-volume__icon--off">${artIcon('volumeOff')}</span><span class="yb-volume__track"><span class="yb-volume__rail"><span class="yb-volume__fill"></span></span><span class="yb-volume__thumb"><span class="yb-volume__tip"></span></span></span>`,
    mounted(this: Artplayer, $el: HTMLElement) {
      mountVolume(this, $el)
    },
  }
}

/** 音量控件的交互与渲染 */
function mountVolume(art: Artplayer, $el: HTMLElement): void {
  const track = $el.querySelector<HTMLElement>('.yb-volume__track')
  const tip = $el.querySelector<HTMLElement>('.yb-volume__tip')
  if (!track || !tip) return

  const render = (): void => {
    const pct = volumePercent(art.video.volume, art.video.muted)
    $el.style.setProperty('--yb-volume', `${pct}%`)
    $el.classList.toggle('is-muted', pct === 0)
    tip.textContent = `${pct}%`
  }

  const setFromPointer = (event: PointerEvent): void => {
    const rect = track.getBoundingClientRect()
    const value = volumeAt(event.clientX, rect.left, rect.width)
    art.video.volume = value
    art.video.muted = value === 0
  }

  $el.addEventListener('click', event => {
    if (track.contains(event.target as Node)) return
    art.video.muted = !art.video.muted
    // 取消静音时音量为 0：回到一半，避免「点了没声」
    if (!art.video.muted && art.video.volume === 0) art.video.volume = 0.5
  })
  track.addEventListener('pointerdown', event => {
    event.stopPropagation()
    track.setPointerCapture(event.pointerId)
    $el.classList.add('is-dragging')
    setFromPointer(event)
  })
  track.addEventListener('pointermove', event => {
    if (track.hasPointerCapture(event.pointerId)) setFromPointer(event)
  })
  const endDrag = (event: PointerEvent): void => {
    if (track.hasPointerCapture(event.pointerId)) {
      track.releasePointerCapture(event.pointerId)
    }
    $el.classList.remove('is-dragging')
  }
  track.addEventListener('pointerup', endDrag)
  track.addEventListener('pointercancel', endDrag)

  art.on('video:volumechange', render)
  render()
}

/**
 * 字幕按钮：已有字幕时切换显示，没有字幕时交给 onRequest（打开在线字幕搜索）。
 * @param onRequest 没有字幕时的回调
 */
function subtitleControl(onRequest: () => void): ArtControl {
  return {
    name: 'ybSubtitle',
    position: 'right',
    index: 25,
    tooltip: '字幕',
    html: artIcon('subtitle'),
    mounted(this: Artplayer, $el: HTMLElement) {
      mountSubtitle(this, $el, onRequest)
    },
  }
}

/** 字幕按钮的交互与渲染 */
function mountSubtitle(
  art: Artplayer,
  $el: HTMLElement,
  onRequest: () => void
): void {
  let loaded = false
  const render = (): void => {
    $el.classList.toggle('is-active', loaded && art.subtitle.show)
  }
  art.on('subtitleLoad', () => {
    loaded = true
    render()
  })
  // 齿轮菜单 / 快捷键 C 切换显示后同步激活态
  art.on('subtitle', render)
  $el.addEventListener('click', () => {
    if (!loaded) {
      onRequest()
      return
    }
    art.subtitle.show = !art.subtitle.show
    render()
  })
}

/**
 * 控制栏自定义控件。
 * @param onSubtitleRequest 没有字幕时点 CC 的回调
 */
export function artSkinControls(onSubtitleRequest: () => void): ArtControl[] {
  return [volumeControl(), subtitleControl(onSubtitleRequest)]
}

/** 设置按钮上的清晰度角标，元数据就绪后按视频高度更新 */
export function installQualityBadge(art: Artplayer): void {
  const update = (): void => {
    const setting = (art.controls as unknown as Record<string, unknown>).setting
    if (!(setting instanceof HTMLElement)) return
    let badge = setting.querySelector<HTMLElement>('.yb-quality-badge')
    if (!badge) {
      badge = document.createElement('span')
      badge.className = 'yb-quality-badge'
      setting.appendChild(badge)
    }
    const text = qualityBadge(art.video.videoHeight)
    badge.textContent = text
    badge.hidden = !text
  }
  art.on('video:loadedmetadata', update)
  art.on('video:resize', update)
}
