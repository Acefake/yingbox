/**
 * 把片头片尾区间画到 Artplayer 的进度条上（只动进度条里我们自己的一层，不碰它的节点）。
 */
import type Artplayer from 'artplayer'

import { type SkipMarks, markSpans } from './skip-rules'
import './skip.css'

const LAYER_CLASS = 'skip-spans'

/** 进度条内层；没有控制栏时为 null */
function progressInner(art: Artplayer): HTMLElement | null {
  return (
    art.template?.$player?.querySelector<HTMLElement>(
      '.art-control-progress-inner'
    ) ?? null
  )
}

/**
 * 按当前标记重画区间；没有区间时移除这一层。
 * @param duration 视频总时长（秒），未知时不画
 */
export function drawSkipSpans(
  art: Artplayer,
  marks: SkipMarks,
  duration: number
): void {
  const inner = progressInner(art)
  if (!inner) return
  const spans = markSpans(marks, duration)
  let layer = inner.querySelector<HTMLElement>(`.${LAYER_CLASS}`)
  if (!spans.length) {
    layer?.remove()
    return
  }
  if (!layer) {
    layer = document.createElement('div')
    layer.className = LAYER_CLASS
    inner.appendChild(layer)
  }
  layer.replaceChildren(
    ...spans.map(span => {
      const el = document.createElement('span')
      el.className = `skip-span skip-span--${span.kind}`
      el.style.left = `${span.left * 100}%`
      el.style.width = `${span.width * 100}%`
      return el
    })
  )
}
