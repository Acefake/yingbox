/**
 * TMDB 令牌：设置里的密钥 `scrape.tmdbToken`（主进程 safeStorage 加密落盘）。
 *
 * 在线页面的 TMDB 请求在渲染层发出，需要同步取令牌，所以启动时经 settings.readSecret 读一次放进内存，
 * 任一窗口改了令牌（secretChanged 事件）再重读。媒体库引擎另存一份（识别 / 刮削在引擎进程），
 * 修改时由 {@link setTmdbToken} 一并下发。Web / PWA 模式没有主进程，存在浏览器里。
 */
import { ref } from 'vue'
import { loadWebSecret, saveWebSecret } from './browser-storage'

const KEY = 'scrape.tmdbToken'

/**
 * 构建时注入的默认令牌（`VITE_TMDB_ACCESS_TOKEN`），为空表示未配置。
 * 禁止把真实令牌硬编码进源码：公开仓库中的密钥等同于泄露。
 */
const ENV_TMDB_TOKEN: string =
  (import.meta.env?.VITE_TMDB_ACCESS_TOKEN as string | undefined) || ''

const bridge = typeof window !== 'undefined' ? window.api?.settings : undefined
const token = ref('')
let loading: Promise<void> | null = null

/** 从主进程（或浏览器）读出令牌放进内存；重复调用复用同一次读取 */
export function loadTmdbToken(): Promise<void> {
  loading ??= (async () => {
    try {
      token.value = bridge
        ? await bridge.readSecret(KEY)
        : loadWebSecret(KEY)
    } catch (error) {
      console.warn('[settings] 读取 TMDB 令牌失败', (error as Error).message)
    }
  })()
  return loading
}

bridge?.onSecretChanged(change => {
  if (change.key !== KEY) return
  loading = null
  void loadTmdbToken()
})

/** 用户填写的令牌（未填为空串，不含构建时默认值）；响应式 */
export function userTmdbToken(): string {
  return token.value
}

/** 当前生效的令牌：用户填写 > 构建时环境变量 > 空 */
export function getTmdbAccessToken(): string {
  return token.value || ENV_TMDB_TOKEN
}

/** 媒体库引擎里令牌的写入口（只依赖这一个方法，便于测试） */
export interface TmdbTokenSink {
  setProviderToken(provider: 'tmdb', token: string | null): Promise<unknown>
}

/** 修改令牌：加密存进设置，再下发给媒体库引擎（网页版没有引擎时跳过） */
export async function setTmdbToken(
  value: string,
  library: TmdbTokenSink | null | undefined = typeof window !== 'undefined'
    ? window.api?.library
    : undefined
): Promise<void> {
  const next = value.trim()
  if (bridge) await bridge.setSecret(KEY, next)
  else saveWebSecret(KEY, next)
  token.value = next
  if (library) await library.setProviderToken('tmdb', next || null)
}
