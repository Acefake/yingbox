/**
 * 渲染层 AI 类型：直接沿用共享定义（src/shared/ai），后续 AI 功能只从 `@/features/ai` 引入。
 */
export type {
  AiChatRequest,
  AiChatResult,
  AiErrorCode,
  AiJsonRequest,
  AiJsonResult,
  AiMessage,
  AiMonthUsage,
  AiProviderId,
  AiTestResult,
  AiTokenUsage,
  AiUsageSummary,
} from '../../../../shared/ai/types'
export type { AiProviderPreset } from '../../../../shared/ai/providers'

/** 渲染层调用选项 */
export interface AiCallOptions {
  /** 取消：abort 后主进程中止请求，Promise 以 cancelled 错误结束 */
  signal?: AbortSignal
}

/** 流式调用选项 */
export interface AiStreamOptions extends AiCallOptions {
  /** 每段增量文本 */
  onDelta: (delta: string) => void
}
