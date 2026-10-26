/**
 * 进度同步令牌（密钥 library.progressServerToken）是否已配置：全应用一份。
 * 订阅主进程的 secretChanged 只做一次；设置面板反复打开也不会叠加监听器
 * （preload 的 offSecretChanged 会去掉该通道全部回调，组件里不能用它退订）。
 */
import { type Ref, ref } from 'vue'

export const PROGRESS_TOKEN_KEY = 'library.progressServerToken'

let configured: Ref<boolean> | null = null

/** 令牌是否已配置（响应式，跟着任一窗口的保存 / 清除更新）。 */
export function progressTokenConfigured(): Ref<boolean> {
  if (configured) return configured
  const settings = window.api!.settings
  const state = ref(settings.snapshot().secrets[PROGRESS_TOKEN_KEY])
  settings.onSecretChanged(change => {
    if (change.key === PROGRESS_TOKEN_KEY) state.value = change.configured
  })
  configured = state
  return state
}
