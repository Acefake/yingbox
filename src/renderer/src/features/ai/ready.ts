/**
 * AI 是否已配置到能发请求：与主进程 assertUsable 同一口径的粗检查（纯函数，调用方传设置值）。
 * 自然语言搜索、AI 助手等据此决定直接调模型，还是提示「去设置 AI」。
 */
import { aiProviderPreset } from '../../../../shared/ai/providers'
import type { AiProviderId } from '../../../../shared/ai/types'

/** 判断 AI 是否可用所需的设置值。 */
export interface AiSetup {
  /** 桌面端（有主进程） */
  available: boolean
  provider: AiProviderId
  baseUrl: string
  model: string
  /** 该服务商的 Key 是否已保存 */
  keyConfigured: boolean
}

/** AI 是否已配置到能发请求。 */
export function aiConfigured(setup: AiSetup): boolean {
  if (!setup.available) return false
  const preset = aiProviderPreset(setup.provider)
  if (!(setup.baseUrl.trim() || preset.baseUrl)) return false
  if (!(setup.model.trim() || preset.model)) return false
  return !preset.needsKey || setup.keyConfigured
}
