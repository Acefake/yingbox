/**
 * IPC 边界上番号相关参数的解析：番号站点设置。非法时抛 LibraryError（invalid-params）。
 */
import { JAV_SITES, type JavSettings, type JavSiteId } from './contract-jav'
import { LibraryError } from './wire'

const SITE_IDS = new Set<string>(JAV_SITES.map(s => s.id))

const invalid = (message: string): never => {
  throw new LibraryError('invalid-params', message)
}

/** 解析番号站点设置：sites 为不重复的已知站点，顺序即优先级。 */
export function parseJavSettings(input: unknown): JavSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return invalid('番号站点设置必须是对象')
  }
  const raw = (input as { sites?: unknown }).sites
  if (!Array.isArray(raw)) return invalid('sites 必须是数组')
  const seen = new Set<string>()
  const sites = raw.map(item => {
    const site = (item ?? {}) as { id?: unknown; enabled?: unknown }
    if (typeof site.id !== 'string' || !SITE_IDS.has(site.id)) {
      return invalid(`未知站点：${String(site.id)}`)
    }
    if (seen.has(site.id)) invalid(`站点重复：${site.id}`)
    seen.add(site.id)
    if (typeof site.enabled !== 'boolean') invalid('enabled 必须是布尔值')
    return { id: site.id as JavSiteId, enabled: site.enabled as boolean }
  })
  return { sites }
}
