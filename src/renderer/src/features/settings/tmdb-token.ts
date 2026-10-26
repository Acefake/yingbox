/**
 * TMDB 令牌：设置里的密钥 `scrape.tmdbToken`。渲染层只写不读。
 *
 * 桌面端：明文只在主进程（safeStorage 加密落盘）；在线页面的 TMDB 请求在后台引擎发出（online.tmdb），
 * 主进程保存时一并下发给媒体库引擎（见 src/main/tmdb.ts）。渲染层只知道「是否已配置」：
 * 启动快照里的密钥状态，之后跟随 secretChanged 事件（任一窗口修改都会广播）。
 * 网页端：令牌存在片库服务（片库 rpc setProviderToken，服务写进自己的密钥文件）；「已配置」读服务的
 * getProviderStatus，环境变量 YINGBOX_TMDB_TOKEN 配置的也算。
 */
import { type Ref, ref } from 'vue'

import {
  LIBRARY_HTTP,
  type ProviderStatus,
} from '../../../../shared/library/ipc'
import { isWebRuntime, serverFetch } from '@/services/library-server'

const KEY = 'scrape.tmdbToken'

const bridge = typeof window !== 'undefined' ? window.api?.settings : undefined
const configured = ref(bridge ? bridge.snapshot().secrets[KEY] : false)

bridge?.onSecretChanged(change => {
  if (change.key === KEY) configured.value = change.configured
})

/** 网页端：调片库服务的令牌接口，按返回的状态更新「已配置」。 */
async function serverProvider(
  method: 'getProviderStatus' | 'setProviderToken',
  params?: { provider: 'tmdb'; token: string | null }
): Promise<void> {
  const response = await serverFetch(LIBRARY_HTTP.rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean
    result?: ProviderStatus
    error?: { message?: string }
  } | null
  if (!data?.ok)
    throw new Error(data?.error?.message || `片库服务返回 ${response.status}`)
  configured.value = Boolean(data.result?.tmdb?.configured)
}

if (!bridge && isWebRuntime())
  void serverProvider('getProviderStatus').catch(() => {})

/** 是否已配置令牌（桌面端不含构建时默认值；网页端含服务的环境变量）；响应式 */
export function tmdbTokenConfigured(): boolean {
  return configured.value
}

/** 修改令牌（空串表示清除）：桌面端交主进程加密保存并下发给媒体库引擎，网页端存进片库服务 */
export async function setTmdbToken(value: string): Promise<void> {
  const next = value.trim()
  if (!bridge) {
    if (!isWebRuntime()) throw new Error('TMDB 令牌需要桌面端或片库服务')
    return serverProvider('setProviderToken', {
      provider: 'tmdb',
      token: next || null,
    })
  }
  await bridge.setSecret(KEY, next)
  configured.value = next !== ''
}

/** 令牌输入框的草稿：输入停顿后保存，空草稿不保存（清除走 clear）。 */
export interface TokenDraft {
  readonly value: Ref<string>
  /** 输入框内容变化 */
  input(value: string): void
  /** 离开页面时：有待保存的输入立即保存 */
  flush(): void
  /** 清空草稿并清除已保存的令牌 */
  clear(): void
}

/** 创建令牌草稿（save 失败由调用方处理）。 */
export function createTokenDraft(
  save: (value: string) => void,
  delayMs = 600
): TokenDraft {
  const value = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = (): void => {
    clearTimeout(timer)
    timer = undefined
  }
  return {
    value,
    input(next) {
      value.value = next
      cancel()
      if (!next.trim()) return
      timer = setTimeout(() => {
        timer = undefined
        save(next)
      }, delayMs)
    },
    flush() {
      if (!timer) return
      cancel()
      save(value.value)
    },
    clear() {
      cancel()
      value.value = ''
      save('')
    },
  }
}
