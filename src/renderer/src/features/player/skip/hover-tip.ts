/**
 * 进度条悬停气泡：在 Artplayer 自带的时间气泡上换成 hoverInfo 的文字（落在片头 / 片尾时带段名），
 * 并按新宽度重新居中、贴边不出界。悬停缩略图（seek-thumbnails）照旧由 Artplayer 的缩略图控件显示。
 */
import type Artplayer from 'artplayer'

import { hoverInfo } from './progress-hover'
import type { SkipMarks } from './skip-rules'

/** 给一个实例装上悬停气泡；marks 每次悬停时读（标记改了立即生效） */
export function installHoverTip(art: Artplayer, marks: () => SkipMarks): void {
  const root = art.template?.$player
  if (!root || typeof art.on !== 'function') return
  art.on('setBar', (type: string, percentage: number) => {
    if (type !== 'hover' || percentage <= 0) return
    const control = root.querySelector<HTMLElement>('.art-control-progress')
    const tip = control?.querySelector<HTMLElement>('.art-progress-tip')
    const info = hoverInfo(percentage, art.duration, marks())
    if (!control || !tip || !info) return
    tip.textContent = info.text
    const barWidth = control.clientWidth
    const tipWidth = tip.clientWidth
    const left = Math.min(
      Math.max(barWidth * percentage - tipWidth / 2, 0),
      Math.max(barWidth - tipWidth, 0)
    )
    tip.style.left = `${left}px`
  })
}
