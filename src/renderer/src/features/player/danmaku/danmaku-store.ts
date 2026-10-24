/**
 * 弹幕的本地状态：条目 / 整部剧绑定的弹幕库（localStorage `danmaku_bindings`，经 @/utils/storage），
 * 以及弹弹play 凭据是否填好（AppId 是普通设置，AppSecret 是密钥，渲染层只知道是否已配置）。
 */
import { ref } from 'vue'

import { getSetting } from '@/features/settings'
import { readStoredArray, saveStoredArray } from '@/utils/storage'

import {
  type DanmakuBinding,
  isBindingFresh,
  sanitizeBindings,
  upsertBinding,
} from './danmaku-rules'

const STORAGE_KEY = 'danmaku_bindings'
const SECRET_KEY = 'danmaku.appSecret'

const load = (): DanmakuBinding[] =>
  sanitizeBindings(readStoredArray<unknown>(STORAGE_KEY))

/** 读一条还有效的绑定 */
export function findBinding(
  key: string,
  nowMs = Date.now()
): DanmakuBinding | null {
  if (!key) return null
  const hit = load().find(b => b.key === key)
  return hit && isBindingFresh(hit, nowMs) ? hit : null
}

/** 写一条绑定（自动匹配不会覆盖手动绑定） */
export function saveBinding(binding: DanmakuBinding): void {
  if (!binding.key) return
  saveStoredArray(STORAGE_KEY, upsertBinding(load(), binding))
}

const settingsBridge =
  typeof window !== 'undefined' ? window.api?.settings : undefined
const secretConfigured = ref(
  settingsBridge ? settingsBridge.snapshot().secrets[SECRET_KEY] : false
)
settingsBridge?.onSecretChanged(change => {
  if (change.key === SECRET_KEY) secretConfigured.value = change.configured
})

/** 弹幕功能是否可用：桌面端且 AppId、AppSecret 都已填写（响应式） */
export function danmakuReady(): boolean {
  return (
    danmakuSupported() &&
    secretConfigured.value &&
    getSetting('danmaku.appId').trim() !== ''
  )
}

/** 当前环境有没有弹幕接口（网页端没有主进程） */
export function danmakuSupported(): boolean {
  return typeof window !== 'undefined' && !!window.api?.danmaku
}

/** 打开设置的「弹幕」分区 */
export function openDanmakuSettings(): void {
  window.dispatchEvent(
    new CustomEvent('app:open-settings', { detail: 'danmaku' })
  )
}
