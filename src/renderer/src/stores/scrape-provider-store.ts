/**
 * 刮削服务提供者配置 Store
 * 支持多种刮削服务，当前内置 TMDB，可扩展自定义服务
 */

export type ScrapeProviderType = 'tmdb' | 'custom'

interface ScrapeProviderConfig {
  /** 当前选中的服务提供者 */
  provider: ScrapeProviderType
  /** TMDB Access Token（Bearer token） */
  tmdbAccessToken: string
  /** 自定义服务名称（用于展示） */
  customProviderName: string
  /** 自定义服务 API 基础 URL */
  customBaseUrl: string
  /** 自定义服务 API Key */
  customApiKey: string
  /** 在线资源 Go 后端地址 */
  goBackendUrl: string
  /**
   * Go 后端访问密钥（对应后端环境变量 YINGBOX_API_KEY）。
   * 仅当后端开放到局域网/NAS 时才需填写；本机访问无需密钥。
   */
  goBackendApiKey: string
}

const STORAGE_KEY = 'scrapeProviderConfig'

/**
 * 构建时注入的默认 Token（`VITE_TMDB_ACCESS_TOKEN`），为空表示未配置。
 * 禁止把真实 Token 硬编码进源码：公开仓库中的密钥等同于泄露。
 */
const ENV_TMDB_TOKEN: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta.env?.VITE_TMDB_ACCESS_TOKEN as string | undefined)) ||
  ''

const defaults: ScrapeProviderConfig = {
  provider: 'tmdb',
  tmdbAccessToken: '',
  customProviderName: '',
  customBaseUrl: '',
  customApiKey: '',
  goBackendUrl: 'http://localhost:31471',
  goBackendApiKey: '',
}

/**
 * 读取配置（每次从 localStorage 获取最新值）
 */
export const getScrapeProviderConfig = (): ScrapeProviderConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      const merged = { ...defaults, ...saved }
      if (merged.provider !== 'tmdb' && merged.provider !== 'custom') {
        merged.provider = 'tmdb'
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
      }
      return merged
    }
  } catch {
    // ignore
  }
  return { ...defaults }
}

/**
 * 保存配置
 */
export const saveScrapeProviderConfig = (
  config: Partial<ScrapeProviderConfig>
): void => {
  const current = getScrapeProviderConfig()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...config }))
  if (
    config.tmdbAccessToken !== undefined &&
    config.tmdbAccessToken !== current.tmdbAccessToken
  ) {
    void syncTmdbTokenToEngine()
  }
}

/**
 * 把当前生效的 TMDB 令牌下发到媒体库引擎（引擎持久化在自己的数据库里，识别与刮削在引擎进程进行）。
 * 在「设置 → 服务」修改令牌时调用；启动时的一次性迁移见 features/library/settings/provider-token.ts。
 * 网页版没有引擎，直接跳过。
 */
const syncTmdbTokenToEngine = async (): Promise<void> => {
  const library =
    typeof window !== 'undefined' ? window.api?.library : undefined
  if (!library) return
  try {
    await library.setProviderToken('tmdb', getTmdbAccessToken() || null)
  } catch (error) {
    console.warn('同步 TMDB 令牌到媒体库引擎失败', (error as Error).message)
  }
}

/**
 * 获取当前生效的 TMDB Access Token。
 * 优先级：用户在设置中填写 > 构建时环境变量 > 空（未配置）。
 */
export const getTmdbAccessToken = (): string => {
  const config = getScrapeProviderConfig()
  return config.tmdbAccessToken || ENV_TMDB_TOKEN
}

/**
 * 获取 在线资源 Go 后端 URL
 */
export const getGoBackendUrl = (): string => {
  const config = getScrapeProviderConfig()
  return (config.goBackendUrl || 'http://localhost:31471').replace(/\/$/, '')
}

/**
 * 获取 Go 后端访问密钥（本机访问可留空）
 */
export const getGoBackendApiKey = (): string => {
  const config = getScrapeProviderConfig()
  return config.goBackendApiKey || ''
}
