/**
 * 统一入口（搜索与 AI 助手共用的居中浮层）快捷键的纯规则：应用内 Cmd/Ctrl+K、Cmd/Ctrl+Shift+K、Cmd/Ctrl+F 的判定，
 * 全局快捷键状态的提示文字。
 */
import type { AssistantShortcutStatus } from '../../../../shared/assistant'

const MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** 唤起 / 收起的键帽文字（侧栏入口、浮层里的快捷键提示） */
export const ENTRY_HOTKEY_LABEL = MAC ? '⌘ K' : 'Ctrl K'
/** 「问 AI」的键帽文字（Cmd/Ctrl+Enter） */
export const ASK_HOTKEY_LABEL = MAC ? '⌘ ↵' : 'Ctrl ↵'

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
  target?: EventTarget | null
}

/**
 * 应用内唤起入口：
 * - Cmd/Ctrl+K（带不带 Shift 都算，Shift 是原来助手的写法）→ 开合切换，播放器前台也可用；
 * - Cmd/Ctrl+F（不带 Shift）→ 只打开；焦点在别的对话框里（播放弹窗、确认框）时不抢；
 * 带 Alt、输入法组字中、按住自动重复都不算。
 */
export function entryHotkey(event: HotkeyInput): 'toggle' | 'open' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  if (event.isComposing || event.repeat) return null
  const key = event.key.toLowerCase()
  if (key === 'k') return 'toggle'
  if (key !== 'f' || event.shiftKey) return null
  const target = event.target as { closest?: (s: string) => unknown } | null
  return target?.closest?.('[role="dialog"]') ? null : 'open'
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
      text: '全局快捷键已关闭，应用内仍可用 Cmd/Ctrl+K 或侧栏的搜索框唤起。',
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
