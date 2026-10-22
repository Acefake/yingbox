/**
 * 把控制器接到 DOM 上（不依赖 Vue，便于测试）：
 *
 * - bindCardPreview：一张卡一个元素（UiPosterCard），指针进入 / 键盘聚焦触发，离开 / 失焦 / 滚出视口停止；
 * - bindGridPreview：整个网格只挂一组委托监听（媒体库海报墙：格子内联、没有组件实例）。
 *
 * 只认鼠标 / 触控笔的悬停（触屏没有悬停）；聚焦只认键盘聚焦（:focus-visible），鼠标点击不触发。
 */
import type { PreviewController } from './controller'
import type { PreviewSource } from './types'

/** 解除绑定 */
export type Unbind = () => void

/** 可注入的 IntersectionObserver 构造器（测试里没有） */
type ObserverCtor = typeof IntersectionObserver | undefined

const isHover = (event: PointerEvent): boolean => event.pointerType !== 'touch'

const focusVisible = (el: Element): boolean => {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

/** 元素离开视口（或被移出文档 / display:none）时回调 */
function watchVisibility(
  el: Element,
  onHidden: () => void,
  Observer: ObserverCtor
): Unbind {
  if (!Observer) return () => {}
  const observer = new Observer(entries => {
    if (entries.some(entry => !entry.isIntersecting)) onHidden()
  })
  observer.observe(el)
  return () => observer.disconnect()
}

/** 一张卡：source() 返回 null 表示这张卡现在不预览（如多选模式）。 */
export function bindCardPreview(
  el: HTMLElement,
  host: () => HTMLElement | null,
  source: () => PreviewSource | null | undefined,
  controller: PreviewController,
  Observer: ObserverCtor = globalThis.IntersectionObserver
): Unbind {
  let unwatch: Unbind = () => {}
  const leave = (): void => {
    unwatch()
    unwatch = () => {}
    const key = source()?.key
    if (key) controller.leave(key)
  }
  const enter = (): void => {
    const s = source()
    const target = host()
    if (!s || !target) return
    controller.enter(s, target)
    unwatch()
    unwatch = watchVisibility(el, leave, Observer)
  }
  const onPointerEnter = (e: PointerEvent): void => {
    if (isHover(e)) enter()
  }
  const onFocusIn = (): void => {
    if (focusVisible(el)) enter()
  }
  const onFocusOut = (e: FocusEvent): void => {
    if (!el.contains(e.relatedTarget as Node | null)) leave()
  }
  el.addEventListener('pointerenter', onPointerEnter)
  el.addEventListener('pointerleave', leave)
  el.addEventListener('focusin', onFocusIn)
  el.addEventListener('focusout', onFocusOut)
  return () => {
    leave()
    el.removeEventListener('pointerenter', onPointerEnter)
    el.removeEventListener('pointerleave', leave)
    el.removeEventListener('focusin', onFocusIn)
    el.removeEventListener('focusout', onFocusOut)
  }
}

/** 网格委托：格子与其中预览层的选择器，以及按格子取来源。 */
export interface GridPreviewOptions {
  /** 格子选择器，如 '.lib-cell' */
  cell: string
  /** 格子里预览层的选择器，如 '.lib-cell-preview' */
  host: string
  /** 格子 → 预览来源；null 表示这格不预览 */
  source: (cell: HTMLElement) => PreviewSource | null
}

/** 网格的委托绑定；返回值的 stop() 立即停掉（多选模式、换查询、页面切走）。 */
export function bindGridPreview(
  root: HTMLElement,
  options: GridPreviewOptions,
  controller: PreviewController,
  Observer: ObserverCtor = globalThis.IntersectionObserver
): { unbind: Unbind; stop: () => void; activeCell: () => HTMLElement | null } {
  let cell: HTMLElement | null = null
  let key: string | null = null
  let unwatch: Unbind = () => {}

  const stop = (): void => {
    unwatch()
    unwatch = () => {}
    if (key) controller.leave(key)
    cell = key = null
  }
  const activate = (next: HTMLElement): void => {
    if (next === cell) return
    stop()
    const s = options.source(next)
    const host = next.querySelector<HTMLElement>(options.host)
    if (!s || !host) return
    cell = next
    key = s.key
    controller.enter(s, host)
    unwatch = watchVisibility(next, stop, Observer)
  }
  const cellOf = (target: EventTarget | null): HTMLElement | null => {
    const el = (target as Element | null)?.closest?.<HTMLElement>(options.cell)
    return el && root.contains(el) ? el : null
  }

  const onPointerOver = (e: PointerEvent): void => {
    if (!isHover(e)) return
    const next = cellOf(e.target)
    if (next) activate(next)
    else stop()
  }
  const onFocusIn = (e: FocusEvent): void => {
    const next = cellOf(e.target)
    if (next && next === e.target && focusVisible(next)) activate(next)
  }
  const onFocusOut = (e: FocusEvent): void => {
    if (cell && !cell.contains(e.relatedTarget as Node | null)) stop()
  }
  root.addEventListener('pointerover', onPointerOver)
  root.addEventListener('pointerleave', stop)
  root.addEventListener('focusin', onFocusIn)
  root.addEventListener('focusout', onFocusOut)
  return {
    stop,
    activeCell: () => cell,
    unbind: () => {
      stop()
      root.removeEventListener('pointerover', onPointerOver)
      root.removeEventListener('pointerleave', stop)
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', onFocusOut)
    },
  }
}
