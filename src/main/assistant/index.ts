/**
 * AI 助手的主进程部分：全局快捷键（设置 assistant.shortcutEnabled + assistant.shortcut，默认 Alt+Space）与语音转写。
 *
 * - 按下快捷键：把主窗口唤到前台（最小化 / 隐藏时恢复，已关闭时重新创建），再让渲染层打开助手浮层。
 *   窗口是新建的或还在加载时先记下「待唤起」，渲染层挂载后经 takeSummon 取走；已加载的窗口直接推 summon；
 * - 设置改了立即换绑；被占用或写法不对时不注册（旧组合继续生效），状态经 shortcutChanged 推给设置页；
 * - 转写走 AI 字幕的识别器（transcribe.ts），启动时清扫上次异常退出留下的录音临时目录。规则见 rules.ts。
 */
import { type WebContents, app, globalShortcut } from 'electron'
import { assistant } from '../../shared/contract/assistant'
import { emit, implement } from '../rpc'
import { onSettingChanged, settingsStore } from '../settings'
import { createShortcutController } from './rules'
import { sweepVoiceTemp, transcribeVoice } from './transcribe'

/** registerAssistant 需要的窗口操作（窗口生命周期归 src/main/index.ts） */
export interface AssistantHost {
  /** 主窗口（关闭后为 null） */
  getMainWindow: () => { webContents: WebContents } | null
  /** 显示并聚焦主窗口；已关闭时重新创建 */
  showMainWindow: () => void
}

/** 全局快捷键的设置值：开关关闭时按空串处理（组合本身保留在设置里） */
function shortcutSetting(): string {
  const store = settingsStore()
  return store.get('assistant.shortcutEnabled')
    ? store.get('assistant.shortcut')
    : ''
}

/** 注册全局快捷键与 assistant 域（app ready 后、创建窗口后调用一次） */
export function registerAssistant(host: AssistantHost): void {
  /** 渲染层还没准备好接收时记下的唤起 */
  let pendingSummon = false

  const summon = (): void => {
    const existed = host.getMainWindow() !== null
    host.showMainWindow()
    const target = host.getMainWindow()
    if (!target) return
    if (existed && !target.webContents.isLoading()) {
      emit(assistant, 'summon', null, target.webContents)
      return
    }
    // 新建 / 加载中的窗口：渲染层挂载后会来取；加载完成时再推一次，兜住已挂载的情况
    pendingSummon = true
    target.webContents.once('did-finish-load', () => {
      if (pendingSummon) emit(assistant, 'summon', null, target.webContents)
    })
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
    const status = shortcut.apply(shortcutSetting())
    if (status.problem)
      console.warn(
        `[assistant] 全局快捷键 ${status.accelerator} 未注册：${status.problem}`
      )
    emit(assistant, 'shortcutChanged', status)
  }

  implement(assistant, {
    shortcutStatus: () => shortcut.status(),
    takeSummon: () => {
      const pending = pendingSummon
      pendingSummon = false
      return pending
    },
    transcribe: (_ctx, audio, isPrivate) => transcribeVoice(audio, isPrivate),
  })

  onSettingChanged(change => {
    if (
      change.key === 'assistant.shortcut' ||
      change.key === 'assistant.shortcutEnabled'
    )
      apply()
  })
  app.on('will-quit', () => shortcut.dispose())

  apply()
  void sweepVoiceTemp()
}
