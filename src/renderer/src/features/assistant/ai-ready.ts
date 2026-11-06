/**
 * AI 是否已配置到能发请求（读设置，响应式）。侧栏入口和助手浮层据此决定要不要显示「问 AI」；
 * 没配置时统一入口退回普通搜索。单独成文件，避免侧栏为它加载整个助手依赖。
 */
import { aiAvailable, aiConfigured, aiKeyConfigured } from '@/features/ai'
import { getSetting } from '@/features/settings'

export function assistantAiReady(): boolean {
  const provider = getSetting('ai.provider')
  return aiConfigured({
    available: aiAvailable(),
    provider,
    baseUrl: getSetting('ai.baseUrl'),
    model: getSetting('ai.model'),
    keyConfigured: aiKeyConfigured(provider),
  })
}
