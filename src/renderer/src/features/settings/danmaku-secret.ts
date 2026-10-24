/**
 * 弹弹play AppSecret：设置里的密钥 `danmaku.appSecret`，渲染层只写不读（同 TMDB 令牌）。
 * 明文只在主进程（safeStorage 加密落盘），用于给弹幕请求签名。
 */
import { ref } from 'vue'

const KEY = 'danmaku.appSecret'

const bridge = typeof window !== 'undefined' ? window.api?.settings : undefined
const configured = ref(bridge ? bridge.snapshot().secrets[KEY] : false)

bridge?.onSecretChanged(change => {
  if (change.key === KEY) configured.value = change.configured
})

/** 是否已填写 AppSecret（响应式） */
export function danmakuSecretConfigured(): boolean {
  return configured.value
}

/** 修改 AppSecret（空串表示清除） */
export async function setDanmakuSecret(value: string): Promise<void> {
  if (!bridge) throw new Error('弹幕需要桌面端')
  const next = value.trim()
  await bridge.setSecret(KEY, next)
  configured.value = next !== ''
}
