/**
 * 模态面板的焦点陷阱：打开期间 Tab / Shift+Tab 在面板内循环，焦点被移到面板外
 * （如全局 Cmd/Ctrl+F 聚焦背后的搜索框）时拉回面板。
 *
 * 谁拥有焦点不看 aria-modal，而是看两样显式的东西：
 * - 陷阱栈：几个模态叠着时（如设置窗口在下、网页端播放层在上），只有最上面（最后打开）的那层拉回焦点，
 *   和 Esc 层栈（use-escape-layer）的叠放语义一致；
 * - 放行区：浏览器顶层的提示与确认框（popover / dialog[open]），以及根上带 data-focus-scope 的
 *   非模态浮层（如播放时侧栏布局的 AI 助手）自己管焦点，焦点落进去不抢回来。
 *
 * useFocusTrap 只管循环与拉回；打开时移入焦点、关闭或卸载时还原焦点用 useModalFocus（设置、网页端播放层），
 * AI 助手由 AssistantLauncher 自己还原。
 */
import { type Ref, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'

/** 可以接收 Tab 焦点的元素 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 非模态浮层根上的标记：焦点落进带这个属性的元素时，下面的焦点陷阱不抢回 */
export const FOCUS_SCOPE_ATTR = 'data-focus-scope'

/** 自己管焦点、陷阱一律放行的区域 */
const RELEASED = `[popover], dialog[open], [${FOCUS_SCOPE_ATTR}]`

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
 * 焦点移到 target 时，这层陷阱该不该把焦点拉回面板。
 * @param target 新获得焦点的元素
 * @param panel 陷阱所在面板
 * @param top 这层陷阱是不是陷阱栈最上面一层
 */
export function shouldReclaim(
  target: Element,
  panel: Element,
  top: boolean
): boolean {
  if (!top || panel.contains(target)) return false
  return target.closest(RELEASED) === null
}

/** 一个焦点陷阱栈：打开顺序就是叠放顺序 */
export interface FocusTrapStack {
  /** 压入一层，返回把它移出的函数（可重复调用） */
  push(layer: object): () => void
  /** layer 是不是最上面一层 */
  isTop(layer: object): boolean
}

/** 新建陷阱栈（应用里用共享栈，单测可以各建各的） */
export function createFocusTrapStack(): FocusTrapStack {
  const layers: object[] = []
  return {
    push(layer) {
      layers.push(layer)
      return () => {
        const index = layers.indexOf(layer)
        if (index >= 0) layers.splice(index, 1)
      }
    },
    isTop: layer => layers.at(-1) === layer,
  }
}

const sharedStack = createFocusTrapStack()

/**
 * 在组件挂载期间启用焦点陷阱；active() 为 true 时入栈（排到最上面），变 false 或卸载时出栈。
 * @param root 面板根元素
 * @param active 现在是否模态（非模态布局时不拦）
 * @returns 绑到面板根元素 @keydown 上的处理函数
 */
export function useFocusTrap(
  root: Ref<HTMLElement | null>,
  active: () => boolean
): (event: KeyboardEvent) => void {
  const layer = {}
  let remove: (() => void) | null = null
  const sync = (open: boolean): void => {
    if (open && !remove) remove = sharedStack.push(layer)
    else if (!open && remove) {
      remove()
      remove = null
    }
  }
  watch(active, sync, { immediate: true, flush: 'sync' })

  const onFocusIn = (event: FocusEvent): void => {
    const panel = root.value
    const target = event.target
    if (!panel || !active() || !(target instanceof Element)) return
    if (!shouldReclaim(target, panel, sharedStack.isTop(layer))) return
    focusableIn(panel)[0]?.focus({ preventScroll: true })
  }

  onMounted(() => document.addEventListener('focusin', onFocusIn))
  onBeforeUnmount(() => {
    document.removeEventListener('focusin', onFocusIn)
    sync(false)
  })

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

/** 值得在关闭后还回去的焦点：仍在文档里、且不是 body（对 body 调 focus 是空操作） */
function restorable(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el !== document.body && el.isConnected
}

/**
 * 模态窗口的完整焦点管理：打开时（含以打开状态挂载）把焦点移进窗口（落在窗口本身，需 tabindex="-1"，
 * 不落在按钮上，免得空格 / 回车误触），期间 Tab 在窗口内循环，关闭或打开状态下卸载时还给打开前的元素。
 * @param root 窗口根元素
 * @param active 窗口现在是否打开（且是模态）
 * @returns 绑到窗口根元素 @keydown 上的处理函数
 */
export function useModalFocus(
  root: Ref<HTMLElement | null>,
  active: () => boolean
): (event: KeyboardEvent) => void {
  const trap = useFocusTrap(root, active)
  let previous: HTMLElement | null = null

  const restore = (): void => {
    const back = previous
    previous = null
    if (restorable(back)) back.focus({ preventScroll: true })
  }

  watch(
    active,
    open => {
      if (!open) {
        restore()
        return
      }
      const current = document.activeElement
      previous = restorable(current) ? current : null
      void nextTick(() => {
        const panel = root.value
        if (panel && active() && !panel.contains(document.activeElement))
          panel.focus({ preventScroll: true })
      })
    },
    { immediate: true }
  )

  // 打开状态下被卸载（如 v-if 挂载的对话框）也要还原，否则焦点随节点移除退化成 body
  // previous 只在打开期间非空，所以不依赖卸载时 active() 是否已经变假
  onBeforeUnmount(() => {
    if (previous) restore()
  })

  return trap
}
