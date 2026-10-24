/**
 * AI 助手的共享类型：主进程（src/main/assistant）、IPC 契约（contract/assistant）与渲染层（features/assistant）共用。
 * 本文件被 sandboxed preload 间接打包，只能是纯 TS。
 */

/** 全局快捷键为什么没生效 */
export type AssistantShortcutProblem =
  /** 写法不是合法的 accelerator */
  | 'invalid'
  /** 已被系统或其他程序占用 */
  | 'conflict'

/** 全局快捷键的当前状态 */
export interface AssistantShortcutStatus {
  /** 设置里的快捷键（已规整）；空串表示关闭 */
  accelerator: string
  /** 是否已注册成功 */
  registered: boolean
  /** 没注册成功的原因；关闭或成功时省略 */
  problem?: AssistantShortcutProblem
}

/** 一次录音转写最长多少秒（再长的录音渲染层先截断） */
export const ASSISTANT_VOICE_MAX_SECONDS = 30

/** 一次录音转写最多多少字节（16 kHz 单声道 16 位 WAV 约 1 MB / 30 秒） */
export const ASSISTANT_VOICE_MAX_BYTES = 2 * 1024 * 1024
