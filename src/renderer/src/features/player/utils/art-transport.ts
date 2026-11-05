/**
 * 控制栏的传输键与时间：进度条两端的「已播 / 剩余」，播放键两侧的「后退 / 快进 10 秒」。
 * 位置由 styles/art-transport.css 在宽播放区里排到进度条两端和胶囊正中，窄播放区仍是原来的一行。
 */
import type Artplayer from 'artplayer'

import type { ArtOption } from './art-options'

type ArtControl = NonNullable<ArtOption['controls']>[number]

/** 一次后退 / 快进的秒数 */
const SKIP_SECONDS = 10

const svg = (inner: string): string =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

const TEN = `<text x="12" y="15.2" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="700">${SKIP_SECONDS}</text>`

const BACK_ICON = svg(
  `<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4.5v4h4"/>${TEN}`
)
const FORWARD_ICON = svg(
  `<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5M19.5 4.5v4h-4"/>${TEN}`
)

/**
 * 秒数写成 m:ss 或 h:mm:ss，位数固定便于对齐。
 * @param seconds 秒；非有限数按 0
 */
export function clockText(seconds: number): string {
  const total =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pair = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pair(m)}:${pair(s)}` : `${pair(m)}:${pair(s)}`
}

/** 剩余时间文字，时长未知时留空 */
export function remainingText(current: number, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return ''
  return `-${clockText(Math.max(0, duration - current))}`
}

function skipControl(
  name: string,
  label: string,
  icon: string,
  delta: number,
  index: number
): ArtControl {
  return {
    name,
    position: 'left',
    index,
    tooltip: label,
    html: icon,
    click(this: Artplayer) {
      const target = this.currentTime + delta
      const max = Number.isFinite(this.duration) ? this.duration : target
      this.currentTime = Math.min(max, Math.max(0, target))
    },
  }
}

function timeControl(
  name: string,
  index: number,
  text: (art: Artplayer) => string
): ArtControl {
  return {
    name,
    position: 'left',
    index,
    html: '<span></span>',
    mounted(this: Artplayer, $el: HTMLElement) {
      const label = $el.firstElementChild as HTMLElement
      const render = (): void => {
        label.textContent = text(this)
      }
      this.on('video:timeupdate', render)
      this.on('video:loadedmetadata', render)
      this.on('video:durationchange', render)
      render()
    },
  }
}

/** 播放器实例 → 「按住对比」回调（增强画布在播放会话里创建，这里只负责按钮） */
const compareHooks = new WeakMap<Artplayer, (on: boolean) => void>()

/** 登记按住 / 松开对比的回调。 */
export function bindCompare(art: Artplayer, hook: (on: boolean) => void): void {
  compareHooks.set(art, hook)
}

const COMPARE_ICON = `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M3,4H21V20H3ZM13,6V18H19V6Z"/></svg>`

/** 按住看原画：只在增强画面显示时出现（播放器加 yb-enhanced 类） */
function compareControl(): ArtControl {
  return {
    name: 'ybCompare',
    position: 'left',
    index: 31,
    tooltip: '按住对比原画',
    html: COMPARE_ICON,
    mounted(this: Artplayer, $el: HTMLElement) {
      const hold = (on: boolean): void => {
        compareHooks.get(this)?.(on)
        $el.classList.toggle('is-held', on)
      }
      $el.addEventListener('pointerdown', event => {
        event.preventDefault()
        $el.setPointerCapture(event.pointerId)
        hold(true)
      })
      for (const name of ['pointerup', 'pointercancel'])
        $el.addEventListener(name, () => hold(false))
    },
  }
}

/** 传输键与进度条两端的时间 */
export function transportControls(): ArtControl[] {
  return [
    compareControl(),
    skipControl(
      'ybBack',
      `后退 ${SKIP_SECONDS} 秒`,
      BACK_ICON,
      -SKIP_SECONDS,
      6
    ),
    skipControl(
      'ybForward',
      `快进 ${SKIP_SECONDS} 秒`,
      FORWARD_ICON,
      SKIP_SECONDS,
      7
    ),
    timeControl('ybTimeNow', 8, art => clockText(art.currentTime)),
    timeControl('ybTimeLeft', 9, art =>
      remainingText(art.currentTime, art.duration)
    ),
  ]
}
