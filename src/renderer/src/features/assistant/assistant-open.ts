/**
 * 助手浮层的开合状态（模块单例）：应用根的 AssistantLauncher 挂浮层，侧栏的 sparkle 入口、
 * 应用内 Cmd/Ctrl+K 与主进程全局快捷键都经这里开合。
 * 打开时记下当前焦点，收起后还给它（元素已不在页面上时不抢焦点）。
 */
import { nextTick, readonly, ref } from 'vue'

const open = ref(false)
let returnFocus: HTMLElement | null = null

/** 浮层是否打开（只读） */
export const assistantOpen = readonly(open)

/** 打开助手；已打开时不动 */
export function openAssistant(): void {
  if (open.value) return
  returnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  open.value = true
}

/** 收起助手，焦点回到打开前的元素 */
export async function closeAssistant(): Promise<void> {
  if (!open.value) return
  open.value = false
  const target = returnFocus
  returnFocus = null
  await nextTick()
  if (target?.isConnected) target.focus({ preventScroll: true })
}

/** 开合切换（快捷键用） */
export function toggleAssistant(): void {
  if (open.value) void closeAssistant()
  else openAssistant()
}
