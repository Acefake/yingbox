/**
 * 推送密钥（Bark 设备 key、Telegram Bot token）：只写不读，渲染层只知道「是否已配置」。
 * 每个密钥一份模块级状态（快照 + secretChanged 事件，监听只挂一次）；
 * 输入框停顿 600ms 后交主进程加密保存（settings.setSecret），清除走 clear。
 */
import { type Ref, ref } from 'vue'
import { toast } from '@/components/ui'
import type { SecretKey } from '../../../../shared/settings/schema'
import { type TokenDraft, createTokenDraft } from '@/features/settings'

/** 推送用到的密钥。 */
export type NotifySecretKey = Extract<
  SecretKey,
  'notify.bark.key' | 'notify.telegram.token'
>

/** 一个密钥的状态。 */
export interface SecretField {
  /** 是否已保存过（响应式） */
  configured: Ref<boolean>
  draft: TokenDraft
  /** 等已发出的保存完成（测试推送前用） */
  settled(): Promise<void>
}

const fields = new Map<NotifySecretKey, SecretField>()

/** 取一个密钥的状态（同一个键共用一份）。 */
export function secretField(key: NotifySecretKey): SecretField {
  const existing = fields.get(key)
  if (existing) return existing
  const bridge = window.api!.settings
  const configured = ref(bridge.snapshot().secrets[key])
  bridge.onSecretChanged(change => {
    if (change.key === key) configured.value = change.configured
  })
  let pending: Promise<void> = Promise.resolve()
  const draft = createTokenDraft(value => {
    const next = value.trim()
    pending = bridge.setSecret(key, next).then(
      () => void (configured.value = next !== ''),
      () => void toast.error('保存失败，系统密钥存储不可用')
    )
  })
  const field = { configured, draft, settled: () => pending }
  fields.set(key, field)
  return field
}
