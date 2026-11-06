import type Artplayer from 'artplayer'
import type { IconName } from '@/components/ui/icons'
import { artIcon } from '../utils/art-options'
import './hotkey-osd.css'

/** 反馈停留时长（毫秒） */
const OSD_MS = 650
const feedback = new WeakMap<
  Artplayer,
  (icon: IconName, text: string) => void
>()

/** 中央反馈层 */
export function createOsd(
  art: Artplayer
): (icon: IconName, text: string) => void {
  const existing = feedback.get(art)
  if (existing) return existing
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
  const show = (name: IconName, label: string): void => {
    if (icon) icon.innerHTML = artIcon(name)
    if (text) text.textContent = label
    el.classList.remove('is-visible')
    void el.offsetWidth // 重新触发淡入
    el.classList.add('is-visible')
    window.clearTimeout(timer)
    timer = window.setTimeout(() => el.classList.remove('is-visible'), OSD_MS)
  }
  feedback.set(art, show)
  art.on('destroy', () => window.clearTimeout(timer))
  return show
}
