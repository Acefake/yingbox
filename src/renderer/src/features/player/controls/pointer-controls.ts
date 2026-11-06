import Artplayer from 'artplayer'
import { createOsd } from '../hotkeys/player-osd'

const REVEAL_MS = 150
const HIDE_MS = 2000

/** 桌面单击切换播放并清屏；双击只执行分区动作，边缘唤出控件。 */
export function installPointerControls(art: Artplayer): void {
  if (Artplayer.utils.isMobile) return
  const root = art.template.$player
  root.classList.add('yb-pointer-controls')
  const hide = (): void => {
    root.classList.add('yb-controls-hidden')
    root.classList.remove('yb-header-visible')
    art.controls.show = false
  }
  const osd = createOsd(art)
  installBlankClicks(art, () => {
    art.setting.show = false
    if (art.video.paused) void art.video.play()?.catch(() => {})
    else art.video.pause()
    hide()
    osd(art.video.paused ? 'pause' : 'play', '')
  })
  installEdgeReveal(art, hide)
}

/** 捕获原生点击，等待双击窗口结束才执行单击。 */
function installBlankClicks(art: Artplayer, single: () => void): void {
  const { $player, $video } = art.template
  let pending: ReturnType<typeof setTimeout> | undefined
  let doubleReady = false
  const cancel = (): void => {
    clearTimeout(pending)
    pending = undefined
  }
  const click = (event: MouseEvent): void => {
    if (event.target !== $video || event.button !== 0) return
    event.stopPropagation()
    doubleReady = event.detail === 2 && pending !== undefined
    cancel()
    if (!doubleReady)
      pending = setTimeout(() => {
        pending = undefined
        single()
      }, Artplayer.DBCLICK_TIME)
  }
  const double = (event: MouseEvent): void => {
    if (event.target !== $video) return
    event.stopPropagation()
    if (doubleReady) {
      doubleReady = false
      art.emit('dblclick', event)
    }
  }
  $player.addEventListener('click', click, true)
  $player.addEventListener('dblclick', double, true)
  art.on('destroy', () => {
    cancel()
    $player.removeEventListener('click', click, true)
    $player.removeEventListener('dblclick', double, true)
  })
}

/** 边缘唤出；暂停和菜单操作期间保留已经显示的控件。 */
function installEdgeReveal(art: Artplayer, hide: () => void): void {
  const { $player } = art.template
  let reveal: ReturnType<typeof setTimeout> | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  let zone = ''
  let dragging = false
  const clear = (): void => {
    clearTimeout(reveal)
    clearTimeout(idle)
  }
  const scheduleHide = (): void => {
    clearTimeout(idle)
    if (!art.video.paused && !art.setting.show && !zone && !dragging) {
      idle = setTimeout(hide, HIDE_MS)
    }
  }
  const show = (edge: string): void => {
    if (edge === 'bottom') {
      $player.classList.remove('yb-controls-hidden')
      art.controls.show = true
    } else $player.classList.add('yb-header-visible')
  }
  const move = (event: MouseEvent): void => {
    const next = pointerZone(art, event)
    if (next === zone) return
    zone = next
    clear()
    if (zone) reveal = setTimeout(() => show(zone), REVEAL_MS)
    else scheduleHide()
  }
  const leave = (): void => {
    zone = ''
    dragging = false
    clear()
    scheduleHide()
  }
  const press = (event: Event): void => {
    dragging =
      event.target instanceof Node &&
      art.template.$bottom.contains(event.target)
    if (dragging) clearTimeout(idle)
  }
  const release = (): void => {
    dragging = false
    scheduleHide()
  }
  // 进度和音量拖动仍依赖冒泡到 document 的鼠标事件。
  art.off('mousemove')
  document.addEventListener('mousemove', move, true)
  document.addEventListener('mouseleave', leave)
  window.addEventListener('blur', leave)
  document.addEventListener('pointerdown', press, true)
  document.addEventListener('pointerup', release, true)
  document.addEventListener('pointercancel', release, true)
  art.on('video:play', scheduleHide)
  art.on('video:pause', () => clearTimeout(idle))
  art.on('setting', scheduleHide)
  art.on('destroy', () => {
    clear()
    document.removeEventListener('mousemove', move, true)
    document.removeEventListener('mouseleave', leave)
    window.removeEventListener('blur', leave)
    document.removeEventListener('pointerdown', press, true)
    document.removeEventListener('pointerup', release, true)
    document.removeEventListener('pointercancel', release, true)
  })
  scheduleHide()
}

function pointerZone(art: Artplayer, event: MouseEvent): string {
  const { $player, $bottom, $setting } = art.template
  const stage = $player.closest('.player-stage') || $player
  const target = event.target
  if (!(target instanceof Node) || !stage.contains(target)) return ''
  if (
    $setting.contains(target) ||
    event.clientY >= $bottom.getBoundingClientRect().top
  )
    return 'bottom'
  return event.clientY <= $player.getBoundingClientRect().top + 48 ? 'top' : ''
}
