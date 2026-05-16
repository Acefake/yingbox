/**
 * 刮削服务提供者配置 Store
 * 支持多种刮削服务，当前内置 TMDB / JavBus，可扩展自定义服务
 */

export type ScrapeProviderType = 'tmdb' | 'javbus' | 'custom'

export interface ScrapeProviderConfig {
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
  /** JavBus Go 后端地址 */
  goBackendUrl: string
}

const STORAGE_KEY = 'scrapeProviderConfig'

const DEFAULT_TMDB_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmMTlmNjFmZjRmNjVhYWRkODkzY2NmZTNkZTVmZGM2MyIsIm5iZiI6MTcxODQ0MzgyMC44NTUsInN1YiI6IjY2NmQ1ZjJjNWI3MTcwNTliZGE3Y2NmNCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.kKzgbixXgO4SV57qNlLJRvxcZv8rt9A6vDi6OZKwTcI'

const defaults: ScrapeProviderConfig = {
  provider: 'tmdb',
  tmdbAccessToken: DEFAULT_TMDB_TOKEN,
  customProviderName: '',
  customBaseUrl: '',
  customApiKey: '',
  goBackendUrl: 'http://localhost:31471',
}

/**
 * 读取配置（每次从 localStorage 获取最新值）
 */
export const getScrapeProviderConfig = (): ScrapeProviderConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return { ...defaults, ...JSON.parse(raw) }
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
}

/**
 * 获取当前生效的 TMDB Access Token
 */
export const getTmdbAccessToken = (): string => {
  const config = getScrapeProviderConfig()
  if (config.provider === 'tmdb' && config.tmdbAccessToken) {
    return config.tmdbAccessToken
  }
  return DEFAULT_TMDB_TOKEN
}

/**
 * 获取 JavBus Go 后端 URL
 */
export const getGoBackendUrl = (): string => {
  const config = getScrapeProviderConfig()
  return (config.goBackendUrl || 'http://localhost:31471').replace(/\/$/, '')
}
