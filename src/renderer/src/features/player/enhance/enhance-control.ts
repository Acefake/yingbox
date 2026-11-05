import type Artplayer from 'artplayer'
import { watch } from 'vue'
import { getSetting, setSetting } from '@/features/settings'

import './enhance-button.css'

/** 同一增强图标用于播放中开关与右上角状态，文案通过可访问名称提供。 */
export const ENHANCE_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z"/></svg>'

/** 播放器内快捷开关沿用全局档位；实际处理状态由帧处理器回报。 */
export function installEnhanceControl(art: Artplayer): (state: string) => void {
  art.controls.add({
    name: 'ybEnhance',
    position: 'left',
    index: 30,
    html: ENHANCE_ICON,
    tooltip: '画质增强',
    click: async () => {
      try {
        await setSetting(
          'player.enhance',
          getSetting('player.enhance') === 'off' ? 'standard' : 'off'
        )
      } catch {
        art.notice.show = '画质增强设置未保存，请重试'
      }
    },
  })
  // controls.add 不返回元素，按类名取回
  const element = art.template.$container.querySelector<HTMLElement>(
    '.art-control-ybEnhance'
  )
  if (!element) return () => {}
  element.setAttribute('role', 'button')
  element.setAttribute('tabindex', '0')
  element.setAttribute('aria-label', '画质增强')
  let unavailable = ''
  const report = (state: string): void => {
    if (state === '不支持' || state === '处理失败') unavailable = state
    if (art.video.dataset.ybEnhanceState === state) return
    art.video.dataset.ybEnhanceState = state
    art.emit('yb:enhance-update')
  }
  const stop = watch(
    () => getSetting('player.enhance'),
    level => {
      element.setAttribute('aria-pressed', String(level !== 'off'))
      element.classList.toggle('is-enhanced', level !== 'off')
      if (level === 'off') report('')
      else if (unavailable) report(unavailable)
      else if (!art.video.dataset.ybEnhanceState) report('等待处理')
    },
    { immediate: true }
  )
  const keyboard = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      element.click()
    }
  }
  element.addEventListener('keydown', keyboard)
  art.on('destroy', () => {
    stop()
    element.removeEventListener('keydown', keyboard)
  })
  return report
}
