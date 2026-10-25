/**
 * 模态面板的焦点陷阱：打开期间 Tab / Shift+Tab 在面板内循环，焦点被移到面板外
 * （如全局 Cmd/Ctrl+F 聚焦背后的搜索框）时拉回面板。浏览器顶层的提示与确认框（popover / dialog）不拦。
 * 打开前的焦点由调用方负责还原（AssistantLauncher）。
 */
import { type Ref, onBeforeUnmount, onMounted } from 'vue'

/** 可以接收 Tab 焦点的元素 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 面板内可聚焦的元素（按文档顺序；inert / hidden 里的不算） */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    el => !el.closest('[inert], [hidden]')
  )
}

/**
 * Tab 键落点：在首尾之间循环；不需要接管时返回 null（交给浏览器）。
 * @param items 面板内可聚焦元素
 * @param current 当前焦点
 * @param backward 是否 Shift+Tab
 */
export function trapTarget<T>(
  items: readonly T[],
  current: T | null,
  backward: boolean
): T | null {
  if (!items.length) return null
  const index = current === null ? -1 : items.indexOf(current)
  if (index === -1) return backward ? items[items.length - 1] : items[0]
  if (backward && index === 0) return items[items.length - 1]
  if (!backward && index === items.length - 1) return items[0]
  return null
}

/**
 * 在组件挂载期间启用焦点陷阱。
 * @param root 面板根元素
 * @param active 现在是否模态（非模态布局时不拦）
 * @returns 绑到面板根元素 @keydown 上的处理函数
 */
export function useFocusTrap(
  root: Ref<HTMLElement | null>,
  active: () => boolean
): (event: KeyboardEvent) => void {
  const onFocusIn = (event: FocusEvent): void => {
    const panel = root.value
    const target = event.target
    if (!panel || !active() || !(target instanceof Element)) return
    if (panel.contains(target) || target.closest('[popover], dialog[open]'))
      return
    focusableIn(panel)[0]?.focus({ preventScroll: true })
  }

  onMounted(() => document.addEventListener('focusin', onFocusIn))
  onBeforeUnmount(() => document.removeEventListener('focusin', onFocusIn))

  return event => {
    const panel = root.value
    if (event.key !== 'Tab' || !panel || !active()) return
    const current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const next = trapTarget(focusableIn(panel), current, event.shiftKey)
    if (!next) return
    event.preventDefault()
    next.focus({ preventScroll: true })
  }
}
