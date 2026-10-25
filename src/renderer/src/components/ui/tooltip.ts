import type { Directive } from 'vue'

/**
 * v-tooltip：图标按钮的悬停提示。
 *
 * 全局只用一个浮层元素，挂在 body 上，不会被父级 overflow 裁掉。
 * 悬停 500ms 后出现（与 macOS 一致），键盘聚焦立即出现；点击、离开、滚动时隐藏。
 * 绑定值为空时不显示。v-tooltip.right 显示在元素右侧（侧栏图标列），默认在上方（放不下时在下方）。
 */

const SHOW_DELAY = 500
const GAP = 8

let tip: HTMLDivElement | null = null
let timer: number | undefined
let anchor: HTMLElement | null = null

const texts = new WeakMap<HTMLElement, string>()
const toRight = new WeakSet<HTMLElement>()
const cleanups = new WeakMap<HTMLElement, () => void>()

function ensureTip(): HTMLDivElement {
  if (tip) return tip
  tip = document.createElement('div')
  tip.className = 'ui-tooltip'
  tip.setAttribute('role', 'tooltip')
  document.body.appendChild(tip)
  return tip
}

function place(el: HTMLElement, node: HTMLDivElement): void {
  const rect = el.getBoundingClientRect()
  const { offsetWidth: w, offsetHeight: h } = node
  if (toRight.has(el)) {
    const top = rect.top + rect.height / 2 - h / 2
    node.style.transform = `translate(${Math.round(rect.right + GAP)}px, ${Math.round(top)}px)`
    return
  }
  const below = rect.top - h - GAP < 4
  const top = below ? rect.bottom + GAP : rect.top - h - GAP
  const left = Math.min(
    Math.max(4, rect.left + rect.width / 2 - w / 2),
    window.innerWidth - w - 4
  )
  node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
}

function show(el: HTMLElement): void {
  const text = texts.get(el)
  if (!text) return
  const node = ensureTip()
  anchor = el
  node.textContent = text
  node.classList.add('is-visible')
  place(el, node)
}

function hide(): void {
  window.clearTimeout(timer)
  anchor = null
  tip?.classList.remove('is-visible')
}

export const vTooltip: Directive<HTMLElement, string | undefined> = {
  mounted(el, binding) {
    texts.set(el, binding.value ?? '')
    if (binding.modifiers.right) toRight.add(el)
    const onEnter = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => show(el), SHOW_DELAY)
    }
    const onFocus = (): void => {
      if (el.matches(':focus-visible')) show(el)
    }
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', hide)
    el.addEventListener('focus', onFocus)
    el.addEventListener('blur', hide)
    el.addEventListener('pointerdown', hide)
    window.addEventListener('scroll', hide, { capture: true, passive: true })
    cleanups.set(el, () => {
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', hide)
      el.removeEventListener('focus', onFocus)
      el.removeEventListener('blur', hide)
      el.removeEventListener('pointerdown', hide)
      window.removeEventListener('scroll', hide, { capture: true })
    })
  },
  updated(el, binding) {
    texts.set(el, binding.value ?? '')
    if (anchor === el && tip) {
      tip.textContent = binding.value ?? ''
      if (!binding.value) hide()
    }
  },
  unmounted(el) {
    if (anchor === el) hide()
    cleanups.get(el)?.()
    cleanups.delete(el)
  },
}
