/**
 * AI 助手的主进程部分：全局快捷键（设置 assistant.shortcut，默认 Alt+Space，空串关闭）与语音转写。
 *
 * - 按下快捷键：把主窗口唤到前台（最小化 / 隐藏时恢复），再推 assistant.summon 让渲染层打开助手浮层；
 * - 设置改了立即换绑；被占用或写法不对时不注册，状态经 shortcutChanged 推给设置页显示提示；
 * - 转写走 AI 字幕的识别器（transcribe.ts）。规则见 rules.ts。
 */
import { type WebContents, app, globalShortcut } from 'electron'
import { assistant } from '../../shared/contract/assistant'
import { emit, implement } from '../rpc'
import { onSettingChanged, settingsStore } from '../settings'
import { createShortcutController } from './rules'
import { transcribeVoice } from './transcribe'

/** registerAssistant 需要的窗口操作（窗口生命周期归 src/main/index.ts） */
export interface AssistantHost {
  /** 主窗口（关闭后为 null） */
  getMainWindow: () => { webContents: WebContents } | null
  /** 显示并聚焦主窗口；已关闭时重新创建 */
  showMainWindow: () => void
}

/** 注册全局快捷键与 assistant 域（app ready 后、创建窗口后调用一次） */
export function registerAssistant(host: AssistantHost): void {
  const summon = (): void => {
    host.showMainWindow()
    const target = host.getMainWindow()
    if (target) emit(assistant, 'summon', null, target.webContents)
  }

  const shortcut = createShortcutController(
    {
      register: (accelerator, callback) =>
        globalShortcut.register(accelerator, callback),
      unregister: accelerator => globalShortcut.unregister(accelerator),
      isRegistered: accelerator => globalShortcut.isRegistered(accelerator),
    },
    summon
  )

  const apply = (): void => {
    const status = shortcut.apply(settingsStore().get('assistant.shortcut'))
    if (status.problem)
      console.warn(
        `[assistant] 全局快捷键 ${status.accelerator} 未注册：${status.problem}`
      )
    emit(assistant, 'shortcutChanged', status)
  }

  implement(assistant, {
    shortcutStatus: () => shortcut.status(),
    transcribe: (_ctx, audio, isPrivate) => transcribeVoice(audio, isPrivate),
  })

  onSettingChanged(change => {
    if (change.key === 'assistant.shortcut') apply()
  })
  app.on('will-quit', () => shortcut.dispose())

  apply()
}
