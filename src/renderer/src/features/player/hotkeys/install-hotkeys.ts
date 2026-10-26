/**
 * 把快捷键与双击手势接到一个播放器实例上（映射见 hotkey-map.ts），动作后在画面中央短暂显示反馈
 * （图标 + 文字，如「快进 10 秒」「音量 45%」，见 hotkey-osd.css）。
 *
 * 键盘监听挂在 window 上：焦点在播放台任何位置都生效（enabled 由播放会话给：焦点在别的对话框里时不生效）。Artplayer 自带的快捷键关着（art-options 的 hotkey: false）。
 * 双击：Artplayer 第一下单击已经切了播放 / 暂停，这里先切回来，再按位置后退 / 快进 10 秒或切全屏。
 */
import type Artplayer from 'artplayer'

import type { IconName } from '@/components/ui/icons'

import { claimDblclick } from '../utils/art-core'
import { artIcon } from '../utils/art-options'
import { volumePercent } from '../utils/art-skin'
import {
  type HotkeyAction,
  dblclickZone,
  resolveHotkey,
  stepRate,
} from './hotkey-map'
import './hotkey-osd.css'

/** 快捷键里交给播放会话做的事 */
export interface HotkeyHandlers {
  /** 这次按键是否归播放器（焦点不在别的对话框） */
  enabled: (event: KeyboardEvent) => boolean
  /** 下一集；没有下一集时为 null */
  next: (() => void) | null
  /** 切换窗口置顶；不能置顶时为 null */
  pin: (() => void) | null
  /** 字幕开关（没有字幕时打开在线字幕面板） */
  subtitle: () => void
}

/** 反馈停留时长（毫秒） */
const OSD_MS = 650

/** 中央反馈层 */
function createOsd(art: Artplayer): (icon: IconName, text: string) => void {
  const el = art.layers?.add?.({
    name: 'ybOsd',
    html: '<div class="yb-osd__icon"></div><div class="yb-osd__text"></div>',
    style: { pointerEvents: 'none' },
  }) as HTMLElement | undefined
  if (!el) return () => {}
  el.classList.add('yb-osd')
  const icon = el.querySelector<HTMLElement>('.yb-osd__icon')
  const text = el.querySelector<HTMLElement>('.yb-osd__text')
  let timer: number | undefined
  return (name, label) => {
    if (icon) icon.innerHTML = artIcon(name)
    if (text) text.textContent = label
    el.classList.remove('is-visible')
    void el.offsetWidth // 重新触发淡入
    el.classList.add('is-visible')
    window.clearTimeout(timer)
    timer = window.setTimeout(() => el.classList.remove('is-visible'), OSD_MS)
  }
}

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n))

/** 执行一个动作并给出反馈 */
function run(
  art: Artplayer,
  action: HotkeyAction,
  handlers: HotkeyHandlers,
  osd: (icon: IconName, text: string) => void
): void {
  const video = art.video
  const duration = Number.isFinite(video.duration) ? video.duration : 0
  switch (action.kind) {
    case 'toggle':
      if (video.paused) void video.play()?.catch(() => {})
      else video.pause()
      osd(video.paused ? 'pause' : 'play', '')
      return
    case 'seek':
      video.currentTime = clamp(
        video.currentTime + action.delta,
        0,
        duration || Infinity
      )
      osd(
        action.delta > 0 ? 'forward' : 'back',
        `${action.delta > 0 ? '快进' : '后退'} ${Math.abs(action.delta)} 秒`
      )
      return
    case 'seekTo':
      if (!duration) return
      video.currentTime = duration * action.fraction
      osd('clock', `${Math.round(action.fraction * 100)}%`)
      return
    case 'volume':
      video.muted = false
      video.volume = clamp(
        Math.round((video.volume + action.delta) * 100) / 100,
        0,
        1
      )
      osd(
        video.volume ? 'volume' : 'volumeOff',
        `音量 ${volumePercent(video.volume, false)}%`
      )
      return
    case 'mute':
      video.muted = !video.muted
      if (!video.muted && video.volume === 0) video.volume = 0.5
      osd(
        video.muted ? 'volumeOff' : 'volume',
        video.muted ? '静音' : `音量 ${volumePercent(video.volume, false)}%`
      )
      return
    case 'fullscreen':
      art.fullscreen = !art.fullscreen
      return
    case 'pin':
      handlers.pin?.()
      return
    case 'subtitle':
      handlers.subtitle()
      return
    case 'rate': {
      const rate = stepRate(video.playbackRate, action.dir)
      video.playbackRate = rate
      osd('clock', `${rate}x`)
      return
    }
    case 'next':
      if (!handlers.next) return
      osd('skipForward', '下一集')
      handlers.next()
  }
}

/** 装上快捷键与双击手势；实例销毁时卸下 */
export function installPlayerHotkeys(
  art: Artplayer,
  handlers: HotkeyHandlers
): void {
  const osd = createOsd(art)
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || !handlers.enabled(event)) return
    const action = resolveHotkey(event)
    if (!action) return
    event.preventDefault()
    run(art, action, handlers, osd)
  }
  window.addEventListener('keydown', onKeydown)

  claimDblclick(art)
  art.on('dblclick', (event: Event) => {
    // 第一下单击已切换播放 / 暂停：切回来
    art.toggle()
    const rect = art.template.$player.getBoundingClientRect()
    const x = (event as MouseEvent).clientX - rect.left
    const zone = dblclickZone(x, rect.width)
    if (zone === 'fullscreen') art.fullscreen = !art.fullscreen
    else
      run(
        art,
        { kind: 'seek', delta: zone === 'back' ? -10 : 10 },
        handlers,
        osd
      )
  })

  art.on('destroy', () => window.removeEventListener('keydown', onKeydown))
}
