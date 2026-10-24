/**
 * AI 助手快捷键的纯规则：应用内 Cmd/Ctrl+K 的判定，全局快捷键状态的提示文字。
 */
import type { AssistantShortcutStatus } from '../../../../shared/assistant'

/** 判定按键需要的字段（测试可传普通对象） */
export interface HotkeyInput {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  isComposing?: boolean
}

/** 应用内唤起 / 收起助手：Cmd+K（macOS）或 Ctrl+K，不带 Shift / Alt，输入法组字中不算 */
export function isAssistantHotkey(event: HotkeyInput): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey &&
    !event.altKey &&
    !event.isComposing &&
    event.key.toLowerCase() === 'k'
  )
}

/** 全局快捷键默认值 */
export const DEFAULT_ASSISTANT_SHORTCUT = 'Alt+Space'

/** 设置页里的状态说明；kind 决定用普通文字还是警告色 */
export function shortcutStatusText(status: AssistantShortcutStatus): {
  kind: 'ok' | 'off' | 'warn'
  text: string
} {
  if (!status.accelerator)
    return {
      kind: 'off',
      text: '全局快捷键已关闭，应用内仍可用 Cmd/Ctrl+K 或右下角光球唤起。',
    }
  if (status.registered)
    return {
      kind: 'ok',
      text: `已启用：在任何地方按 ${status.accelerator} 唤起助手。`,
    }
  if (status.problem === 'invalid')
    return {
      kind: 'warn',
      text: `「${status.accelerator}」不是有效的快捷键写法，例如 Alt+Space、CommandOrControl+Shift+K。`,
    }
  return {
    kind: 'warn',
    text: `${status.accelerator} 已被系统或其他程序占用，换一个组合试试。`,
  }
}
