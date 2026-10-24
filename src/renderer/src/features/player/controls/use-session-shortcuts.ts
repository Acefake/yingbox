/**
 * 播放会话的 YouTube 式操作：每换一集（新的 Artplayer 实例）装上控制栏「下一集」「小窗」按钮
 * 与快捷键 / 双击手势。小窗按钮与快捷键 I 只在设置开着小窗（ui.miniPlayer）时有。
 */
import type Artplayer from 'artplayer'
import { type ShallowRef, watch } from 'vue'

import { useSetting } from '@/features/settings'

import { installPlayerHotkeys } from '../hotkeys/install-hotkeys'
import { installSessionControls } from './session-controls'

/** useSessionShortcuts 的输入 */
export interface SessionShortcutsInput {
  /** 当前这一集的实例 */
  art: ShallowRef<Artplayer | null>
  /** 切到下一集的动作；没有下一集为 null（装按钮时读一次） */
  next: () => (() => void) | null
  /** 请播放弹窗缩成小窗 */
  minimize: () => void
  /** 快捷键是否生效（缩在小窗里时不生效） */
  active: () => boolean
  /** 字幕开关（快捷键 C） */
  toggleSubtitle: () => void
}

/** 焦点在别的对话框里（播放弹窗之外）时快捷键不归播放器 */
function inOtherDialog(event: KeyboardEvent): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  const dialog = target.closest('[role="dialog"]')
  return Boolean(dialog && !dialog.classList.contains('player-modal'))
}

export function useSessionShortcuts(input: SessionShortcutsInput): void {
  const miniEnabled = useSetting('ui.miniPlayer')
  watch(input.art, instance => {
    if (!instance) return
    const next = input.next()
    const mini = miniEnabled.value ? input.minimize : null
    installSessionControls(instance, { next, mini })
    installPlayerHotkeys(instance, {
      enabled: event => input.active() && !inOtherDialog(event),
      next,
      mini,
      subtitle: input.toggleSubtitle,
    })
  })
}
