/**
 * 播放会话加到控制栏上的两个按钮（照 YouTube 的位置）：
 *   - 左侧「下一集」：紧跟播放 / 暂停，有下一集时才有；
 *   - 右侧「置顶」：设置（齿轮）与画中画之间，只在独立播放器窗口里有。
 * 控制栏其余部分：左侧音量（悬停展开）、时间；右侧字幕 CC、设置、画中画、全屏（见 utils/art-skin、art-options）。
 */
import type Artplayer from 'artplayer'

import { type ArtOption, artIcon } from '../utils/art-options'

type ArtControl = NonNullable<ArtOption['controls']>[number]

/** installSessionControls 的输入；不给就不加对应按钮 */
export interface SessionControls {
  next?: (() => void) | null
  pin?: (() => void) | null
}

const control = (
  name: string,
  position: 'left' | 'right',
  index: number,
  tooltip: string,
  html: string,
  run: () => void
): ArtControl => ({
  name,
  position,
  index,
  tooltip,
  html,
  click: () => run(),
  mounted($el: HTMLElement) {
    $el.setAttribute('role', 'button')
    $el.setAttribute('aria-label', tooltip.replace(/（.*）$/, ''))
  },
})

/** 给一个实例加上「下一集」「置顶」按钮（每个实例只装一次） */
export function installSessionControls(
  art: Artplayer,
  controls: SessionControls
): void {
  if (!art.controls?.add) return
  if (controls.next)
    art.controls.add(
      control(
        'ybNext',
        'left',
        15,
        '下一集（Shift+N）',
        artIcon('skipForward'),
        controls.next
      )
    )
  if (controls.pin)
    art.controls.add(
      control('ybPin', 'right', 35, '置顶（I）', artIcon('pin'), controls.pin)
    )
}
