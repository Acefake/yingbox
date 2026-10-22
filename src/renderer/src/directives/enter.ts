import type { ObjectDirective } from 'vue'
import { isSubmitKey } from '@/utils/keyboard'

/** v-enter 的处理函数：拿到那次回车的 keydown 事件。 */
export type EnterHandler = (event: KeyboardEvent) => void

interface Entry {
  run: EnterHandler
  listener: (event: KeyboardEvent) => void
}

const entries = new WeakMap<HTMLElement, Entry>()

/**
 * 这次回车是不是冲着绑定元素来的：绑定元素本身（如 role=button 的标签）或里面的文字输入框。
 * 组件里别的控件（UiInput 的清空按钮等）自己处理回车，不当成提交。
 */
export function isEnterTarget(
  el: EventTarget,
  target: EventTarget | null
): boolean {
  if (target === el) return true
  const tag = (target as Partial<HTMLElement> | null)?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA'
}

/**
 * 回车提交，但让过输入法：`<UiInput v-enter="submit" />`。
 *
 * 代替 `@keydown.enter`：中文输入法里回车是把拼音 / 英文番号上屏，组字中的回车不触发（见 utils/keyboard）。
 * 触发时顺带 preventDefault（等同原来的 `.prevent`）。
 * 用在组件上时挂在组件根元素，输入框的 keydown 冒泡上来照样能收到。
 */
export const vEnter: ObjectDirective<HTMLElement, EnterHandler> = {
  mounted(el, { value }) {
    const entry: Entry = {
      run: value,
      listener: event => {
        if (!isSubmitKey(event) || !isEnterTarget(el, event.target)) return
        event.preventDefault()
        entry.run(event)
      },
    }
    entries.set(el, entry)
    el.addEventListener('keydown', entry.listener)
  },
  updated(el, { value }) {
    const entry = entries.get(el)
    if (entry) entry.run = value
  },
  beforeUnmount(el) {
    const entry = entries.get(el)
    if (!entry) return
    el.removeEventListener('keydown', entry.listener)
    entries.delete(el)
  },
}
