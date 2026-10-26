/**
 * 播放会话的 YouTube 式操作：每换一集（新的 Artplayer 实例）装上控制栏「下一集」「置顶」按钮
 * 与快捷键 / 双击手势。置顶按钮与快捷键 I 只在独立播放器窗口里有（网页端没有窗口可置顶）。
 */
import type Artplayer from 'artplayer'
import { type ShallowRef, watch } from 'vue'

import { installPlayerHotkeys } from '../hotkeys/install-hotkeys'
import { installSessionControls } from './session-controls'

/** useSessionShortcuts 的输入 */
export interface SessionShortcutsInput {
  /** 当前这一集的实例 */
  art: ShallowRef<Artplayer | null>
  /** 切到下一集的动作；没有下一集为 null（装按钮时读一次） */
  next: () => (() => void) | null
  /** 切换窗口置顶；不能置顶时为 null（装按钮时读一次） */
  pin: () => (() => void) | null
  /** 字幕开关（快捷键 C） */
  toggleSubtitle: () => void
}

/** 焦点在别的对话框里（播放层之外）时快捷键不归播放器 */
function inOtherDialog(event: KeyboardEvent): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  const dialog = target.closest('[role="dialog"]')
  return Boolean(dialog && !dialog.classList.contains('player-modal'))
}

export function useSessionShortcuts(input: SessionShortcutsInput): void {
  watch(input.art, instance => {
    if (!instance) return
    const next = input.next()
    const pin = input.pin()
    installSessionControls(instance, { next, pin })
    installPlayerHotkeys(instance, {
      enabled: event => !inOtherDialog(event),
      next,
      pin,
      subtitle: input.toggleSubtitle,
    })
  })
}
