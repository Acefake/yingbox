/**
 * AI API Key：每个服务商一份设置密钥（ai.apiKey.<服务商>），渲染层只写不读。
 *
 * 明文只在主进程（safeStorage 加密落盘）；渲染层只知道「是否已配置」：
 * 启动快照里的密钥状态，之后跟随 secretChanged 事件（任一窗口修改都会广播）。
 */
import { reactive } from 'vue'
import { AI_PROVIDERS, aiKeySecret } from '../../../../shared/ai/providers'
import type { AiProviderId } from './types'

const bridge = typeof window !== 'undefined' ? window.api?.settings : undefined
const snapshot = bridge?.snapshot().secrets

const configured = reactive<Record<string, boolean>>(
  Object.fromEntries(
    AI_PROVIDERS.flatMap(p => {
      const key = aiKeySecret(p.id)
      return key ? [[key, snapshot?.[key] ?? false]] : []
    })
  )
)

bridge?.onSecretChanged(change => {
  if (change.key in configured) configured[change.key] = change.configured
})

/** 该服务商的 Key 是否已保存（Ollama 不需要 Key，恒为 false）；响应式 */
export function aiKeyConfigured(provider: AiProviderId): boolean {
  const key = aiKeySecret(provider)
  return key ? Boolean(configured[key]) : false
}

/** 保存 / 更换（非空）或清除（空串）某服务商的 Key */
export async function setAiKey(
  provider: AiProviderId,
  value: string
): Promise<void> {
  const key = aiKeySecret(provider)
  if (!key) return
  if (!bridge) throw new Error('API Key 需要桌面端')
  const next = value.trim()
  await bridge.setSecret(key, next)
  configured[key] = next !== ''
}
