/**
 * 控制栏的「弹」按钮：单击开关弹幕，右键或长按打开弹幕面板。按钮只负责交互，状态由 useDanmaku 给。
 */
import type Artplayer from 'artplayer'

import type { ArtOption } from '../utils/art-options'

/** Artplayer 自定义控件 */
export type ArtControl = NonNullable<ArtOption['controls']>[number]

/** 长按多久算打开面板（毫秒） */
const LONG_PRESS_MS = 500

/** 按钮的回调 */
export interface DanmakuControlHandlers {
  toggle: () => void
  openPanel: () => void
  /** 按钮挂上后交出节点，便于外面同步激活状态 */
  mounted: ($el: HTMLElement) => void
}

/** 创建「弹」按钮 */
export function danmakuControl(handlers: DanmakuControlHandlers): ArtControl {
  return {
    name: 'ybDanmaku',
    position: 'right',
    index: 24,
    tooltip: '弹幕（右键设置）',
    html: '<span class="yb-danmaku-glyph" aria-hidden="true">弹</span>',
    mounted(this: Artplayer, $el: HTMLElement) {
      let timer: number | undefined
      let longPressed = false
      const cancel = (): void => {
        if (timer !== undefined) window.clearTimeout(timer)
        timer = undefined
      }
      $el.setAttribute('role', 'button')
      $el.setAttribute('aria-label', '弹幕')
      $el.addEventListener('pointerdown', event => {
        if (event.button !== 0) return
        longPressed = false
        cancel()
        timer = window.setTimeout(() => {
          longPressed = true
          handlers.openPanel()
        }, LONG_PRESS_MS)
      })
      $el.addEventListener('pointerup', cancel)
      $el.addEventListener('pointerleave', cancel)
      $el.addEventListener('click', () => {
        if (longPressed) {
          longPressed = false
          return
        }
        handlers.toggle()
      })
      $el.addEventListener('contextmenu', event => {
        event.preventDefault()
        event.stopPropagation()
        handlers.openPanel()
      })
      handlers.mounted($el)
    },
  }
}
