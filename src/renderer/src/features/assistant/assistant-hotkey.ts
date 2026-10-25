/**
 * AI 助手快捷键的纯规则：应用内 Cmd/Ctrl+Shift+K 的判定，全局快捷键状态的提示文字。
 */
import type { AssistantShortcutStatus } from '../../../../shared/assistant'

/** 应用内快捷键的键帽文字（侧栏入口的悬停提示、助手里的快捷键提示） */
export const ASSISTANT_HOTKEY_LABEL =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘ ⇧ K'
    : 'Ctrl Shift K'

/** 判定按键需要的字段（测试可传普通对象） */
export interface HotkeyInput {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  isComposing?: boolean
  /** 按住不放时的自动重复 */
  repeat?: boolean
}

/** 应用内唤起 / 收起助手：Cmd+K（macOS）或 Ctrl+K，带 Shift、不带 Alt；输入法组字中与按住自动重复不算 */
export function isAssistantHotkey(event: HotkeyInput): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    !event.altKey &&
    !event.isComposing &&
    !event.repeat &&
    event.key.toLowerCase() === 'k'
  )
}

/** 全局快捷键默认值 */
export const DEFAULT_ASSISTANT_SHORTCUT = 'Alt+Space'

/** 设置页里的状态说明；kind 决定用普通文字还是警告色。还没取到状态（null）时不显示 */
export function shortcutStatusText(status: AssistantShortcutStatus | null): {
  kind: 'ok' | 'off' | 'warn' | 'unknown'
  text: string
} {
  if (!status) return { kind: 'unknown', text: '' }
  if (!status.accelerator)
    return {
      kind: 'off',
      text: '全局快捷键已关闭，应用内仍可用 Cmd/Ctrl+Shift+K 或侧栏的 AI 助手按钮唤起。',
    }
  if (status.registered)
    return {
      kind: 'ok',
      text: `已启用：在任何地方按 ${status.accelerator} 唤起助手。`,
    }
  const still = status.active ? `当前仍使用 ${status.active}。` : ''
  if (status.problem === 'invalid')
    return {
      kind: 'warn',
      text: `「${status.accelerator}」不是有效的快捷键写法，例如 Alt+Space、CommandOrControl+Shift+K。${still}`,
    }
  if (status.problem === 'conflict')
    return {
      kind: 'warn',
      text: `${status.accelerator} 已被系统或其他程序占用，换一个组合试试。${still}`,
    }
  return { kind: 'unknown', text: '' }
}
