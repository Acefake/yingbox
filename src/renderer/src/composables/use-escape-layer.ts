import { onScopeDispose, watch } from 'vue'
import {
  type KeyInput,
  isComposing,
  isDismissKey,
  isEscapeKey,
} from '@/utils/keyboard'

/**
 * Esc 按层关闭。
 *
 * 同一时间可能叠着几层浮层（手机抽屉、后台任务面板、设置面板、媒体库面板、网页播放器……），
 * 一次 Esc 只关最上面（最后打开）的那一层；输入法组字中的 Esc 只取消组字，哪一层都不关。
 *
 * 层的顺序由打开先后决定：各浮层用 useEscapeLayer 登记，全应用只有一个 window keydown 监听。
 * 比浮层更靠里的处理先于这里执行，处理完 stopPropagation / preventDefault，这里就不再关别的层：
 * - 原生 <dialog>（UiConfirmDialog）用 guardDialogEscape；
 * - 右键菜单（directives/context-menu）在 document 上处理并截断冒泡。
 */

/** 层栈处理时用到的事件字段（测试里可以传普通 Event）。 */
type EscapeEvent = KeyInput & Pick<Event, 'defaultPrevented' | 'preventDefault'>

/** 一个 Esc 层栈。 */
export interface EscapeStack {
  /** 压入一层，返回把它移出的函数（可重复调用）。 */
  push(close: () => void): () => void
  /** 处理一次按键：关掉最上面一层并 preventDefault，返回是否关了。 */
  handle(event: EscapeEvent): boolean
}

/** 新建层栈（应用里用下面的共享栈，单测可以各建各的）。 */
export function createEscapeStack(): EscapeStack {
  const layers: Array<{ close: () => void }> = []
  return {
    push(close) {
      const layer = { close }
      layers.push(layer)
      return () => {
        const index = layers.indexOf(layer)
        if (index >= 0) layers.splice(index, 1)
      }
    },
    handle(event) {
      if (!isDismissKey(event) || event.defaultPrevented) return false
      const top = layers.at(-1)
      if (!top) return false
      event.preventDefault()
      top.close()
      return true
    },
  }
}

const shared = createEscapeStack()
let listening = false

/** 用共享层栈处理一次按键（window 监听调用它；单测直接调）。 */
export function handleEscape(event: EscapeEvent): boolean {
  return shared.handle(event)
}

/**
 * 把一个浮层登记到 Esc 层栈：active() 为 true 时入栈（排到最上面），变 false 或组件卸载时出栈。
 * @param active - 浮层是否打开
 * @param close - Esc 时调用，负责把 active 变成 false
 */
export function useEscapeLayer(active: () => boolean, close: () => void): void {
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener('keydown', handleEscape)
  }
  let remove: (() => void) | null = null
  const sync = (open: boolean): void => {
    if (open && !remove) remove = shared.push(close)
    else if (!open && remove) {
      remove()
      remove = null
    }
  }
  watch(active, sync, { immediate: true, flush: 'sync' })
  onScopeDispose(() => sync(false))
}

/**
 * 原生 <dialog> 的 keydown：Esc 由对话框自己关（cancel 事件），不再冒泡去关外层；
 * 输入法组字中的 Esc 连对话框也不关（preventDefault 让浏览器不发 cancel）。
 */
export function guardDialogEscape(
  event: KeyInput & Pick<Event, 'preventDefault' | 'stopPropagation'>
): void {
  if (!isEscapeKey(event)) return
  if (isComposing(event)) event.preventDefault()
  event.stopPropagation()
}
