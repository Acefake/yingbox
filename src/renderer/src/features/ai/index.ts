/**
 * AI feature 的公共出口：所有 AI 功能（AI 字幕、刮削兜底、自然语言搜索、今晚看什么、前情提要）
 * 只经这里调用模型。主进程实现见 src/main/ai，设置页见 features/settings/sections/AiSettings.vue。
 */
export {
  AiCallError,
  aiAvailable,
  chat,
  chatJson,
  chatStream,
  getAiUsage,
  onAiUsageChanged,
  testAiConnection,
  toAiError,
} from './api'
export { aiKeyConfigured, setAiKey } from './key'
export { formatMonthUsage, formatTokens } from './format'
export {
  AI_PROVIDERS,
  aiProviderPreset,
  isLocalEndpoint,
} from '../../../../shared/ai/providers'
export type * from './types'
