/**
 * 推送密钥（Bark 设备 key、Telegram Bot token）：只写不读，渲染层只知道「是否已配置」。
 * 每个密钥一份模块级状态（快照 + secretChanged 事件，监听只挂一次）；
 * 输入框停顿 600ms 后保存到桌面密钥链或 NAS 的密钥文件，清除走 clear。
 */
import { type Ref, ref } from 'vue'
import { toast } from '@/components/ui'
import type { SecretKey } from '../../../../shared/settings/schema'
import { type TokenDraft, createTokenDraft } from '@/features/settings'
import { notificationApi } from './api'

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
  const bridge = notificationApi()
  const channel = key === 'notify.bark.key' ? 'bark' : 'telegram'
  const configured = ref(false)
  let revision = 0
  void bridge
    ?.configured()
    .then(status => {
      if (revision === 0) configured.value = status[channel]
    })
    .catch(() => toast.error('读取推送配置失败'))
  window.api?.settings.onSecretChanged(change => {
    if (change.key === key) {
      revision++
      configured.value = change.configured
    }
  })
  let pending: Promise<void> = Promise.resolve()
  const draft = createTokenDraft(value => {
    const next = value.trim()
    const mine = ++revision
    pending = pending
      .then(() =>
        bridge
          ? bridge.setSecret(channel, next)
          : Promise.reject(new Error('推送不可用'))
      )
      .then(
        () => {
          if (mine === revision) configured.value = next !== ''
        },
        () => void toast.error('推送密钥保存失败')
      )
  })
  const field = { configured, draft, settled: () => pending }
  fields.set(key, field)
  return field
}
