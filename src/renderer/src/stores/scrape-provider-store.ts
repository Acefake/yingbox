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
 * 获取当前生效的 TMDB Access Token。
 * 优先级：用户在设置中填写 > 构建时环境变量 > 空（未配置）。
 */
export const getTmdbAccessToken = (): string => {
  const config = getScrapeProviderConfig()
  return config.tmdbAccessToken || ENV_TMDB_TOKEN
}

/** 是否已配置 TMDB Token（未配置时 TMDB 相关功能不可用） */
export const hasTmdbToken = (): boolean => getTmdbAccessToken() !== ''

/**
 * 获取 JavBus Go 后端 URL
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
