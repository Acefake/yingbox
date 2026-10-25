/**
 * 侧栏收起状态：桌面端的 64px 图标列开关，记在 localStorage（重启后保持），
 * 快捷键 Cmd/Ctrl + B 切换（不带 Shift / Alt，输入法组字中、弹窗里不算）。
 */
import { ref, watch, type Ref } from 'vue'

/** localStorage 键：'1' 为收起 */
export const SIDEBAR_COLLAPSED_KEY = 'yingbox.sidebar.collapsed'

/** 侧栏开关钮悬停提示里的快捷键文字 */
export const SIDEBAR_HOTKEY_LABEL =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘ B'
    : 'Ctrl B'

/** isSidebarShortcut 用到的按键字段 */
export interface SidebarShortcutEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  isComposing?: boolean
  target?: EventTarget | null
}

/** 是否是切换侧栏的快捷键：Cmd+B（macOS）或 Ctrl+B，弹窗（role="dialog"）里不响应 */
export function isSidebarShortcut(event: SidebarShortcutEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey)
    return false
  if (event.isComposing || event.key.toLowerCase() !== 'b') return false
  const target = event.target as { closest?: (s: string) => unknown } | null
  return !target?.closest?.('[role="dialog"]')
}

/** 读出上次的收起状态（存储不可用时为展开） */
export function readSidebarCollapsed(
  storage: Pick<Storage, 'getItem'>
): boolean {
  try {
    return storage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/** 收起状态的 ref：初值取自 localStorage，改动写回 */
export function useSidebarCollapsed(): Ref<boolean> {
  const collapsed = ref(readSidebarCollapsed(localStorage))
  watch(collapsed, value => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? '1' : '0')
    } catch {
      // 存储满或被禁用：只影响下次启动，不打断操作
    }
  })
  return collapsed
}
