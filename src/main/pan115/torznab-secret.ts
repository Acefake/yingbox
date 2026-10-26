/**
 * Torznab 配置的存储格式：地址列表与 API Key 一起放在一个密钥里（桌面端 safeStorage 的 pan115.torznab，
 * 服务端 secrets.json 的同名键），与 115 会话同一种存储；渲染层只拿到地址和「填没填 Key」。
 * 服务端可用环境变量 YINGBOX_TORZNAB_URL（多个用逗号或换行分隔）与 YINGBOX_TORZNAB_API_KEY 兜底。
 */
import { MAX_TORZNAB_URLS } from '../../shared/contract/pan115'

/** 密钥键（两端同名） */
export const TORZNAB_SECRET_KEY = 'pan115.torznab'

/** 保存的 Torznab 配置 */
export interface TorznabSecret {
  urls: string[]
  apiKey: string
}

/** 地址列表：去空白、去重、限个数 */
export function cleanTorznabUrls(urls: readonly string[]): string[] {
  return [...new Set(urls.map(url => url.trim()).filter(Boolean))].slice(
    0,
    MAX_TORZNAB_URLS
  )
}

/** 密钥字符串 → 配置；空串或格式不对时 null */
export function parseTorznabSecret(
  raw: string | undefined
): TorznabSecret | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as { urls?: unknown; apiKey?: unknown }
    const urls = Array.isArray(value.urls)
      ? cleanTorznabUrls(value.urls.filter(url => typeof url === 'string'))
      : []
    const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : ''
    return urls.length || apiKey ? { urls, apiKey } : null
  } catch {
    return null
  }
}

/** 配置 → 密钥字符串；null 为空串（删除） */
export function serializeTorznabSecret(value: TorznabSecret | null): string {
  return value ? JSON.stringify(value) : ''
}

/** 服务端环境变量兜底：文件里没存时用 */
export function torznabFromEnv(env: NodeJS.ProcessEnv): TorznabSecret | null {
  const urls = cleanTorznabUrls((env.YINGBOX_TORZNAB_URL ?? '').split(/[,\n]/))
  return urls.length
    ? { urls, apiKey: env.YINGBOX_TORZNAB_API_KEY?.trim() ?? '' }
    : null
}
