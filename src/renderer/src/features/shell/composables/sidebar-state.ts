/**
 * 侧栏收起状态：桌面端的 64px 图标列开关，存在设置 ui.sidebarCollapsed 里（重启后保持），
 * 快捷键 Cmd/Ctrl + B 切换（不带 Shift / Alt，输入法组字中、弹窗里不算）。
 */
import type { WritableComputedRef } from 'vue'

import { useSetting } from '@/features/settings'

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

/** 收起状态（读写设置 ui.sidebarCollapsed） */
export function useSidebarCollapsed(): WritableComputedRef<boolean> {
  return useSetting('ui.sidebarCollapsed')
}
