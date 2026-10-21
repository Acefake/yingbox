/**
 * 源订阅的纯规则：解析远程清单、清洗站点名、生成镜像地址。
 * 支持 LunaTV / MoonTV（`api_site` 对象）与通用 `sites` 数组两种格式。
 */
import type { ApiSite } from '../types'

/** 默认订阅：hafrey1/LunaTV-config 纯净版，上游每小时测活并剔除失效源。 */
export const DEFAULT_SUBSCRIPTION_URL =
  'https://raw.githubusercontent.com/hafrey1/LunaTV-config/main/jin18.json'

const CMS_API = /^https?:\/\/.+(?:api\.php\/provide\/vod|api\/json\.php)/i

/** 去掉名称首尾的表情、装饰符号与多余空白。 */
export const cleanSiteName = (name: string): string =>
  name
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/^[\s\-_·|]+|[\s\-_·|]+$/g, '')
    .trim()

const asEntry = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const toSite = (value: unknown): ApiSite | null => {
  const entry = asEntry(value)
  if (!entry || entry.is_adult === true) return null
  const api = typeof entry.api === 'string' ? entry.api.trim() : ''
  if (!CMS_API.test(api)) return null
  const raw = typeof entry.name === 'string' ? entry.name : ''
  return { name: cleanSiteName(raw) || new URL(api).hostname, api }
}

/** 解析订阅内容，返回去重后的 CMS 站点；格式不认识时返回空数组。 */
export const parseSubscription = (raw: unknown): ApiSite[] => {
  const root = asEntry(raw)
  if (!root) return []
  const entries = Array.isArray(root.sites)
    ? root.sites
    : Object.values(asEntry(root.api_site) ?? {})
  const seen = new Set<string>()
  const sites: ApiSite[] = []
  for (const value of entries) {
    const site = toSite(value)
    if (!site || seen.has(site.api)) continue
    seen.add(site.api)
    sites.push(site)
  }
  return sites
}

/**
 * 订阅地址的候选列表：GitHub raw 在部分网络下不可达，依次补上 jsDelivr 与代理镜像。
 * 非 GitHub 地址原样返回。
 */
export const mirrorUrls = (url: string): string[] => {
  const match =
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?([^/]+)\/(.+)$/.exec(
      url
    )
  if (!match) return [url]
  const [, owner, repo, branch, path] = match
  return [
    url,
    `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`,
    `https://ghp.xptvhelper.link/${url}`,
  ]
}

/**
 * 订阅更新后启用列表的变化：新出现的源默认启用，从订阅里消失的源取消启用。
 * 用户手动停用过、仍在订阅里的源保持停用。
 */
export const planSubscriptionSelection = (input: {
  previous: string[]
  next: string[]
  selected: string[]
}): { enable: string[]; disable: string[] } => {
  const before = new Set(input.previous)
  const after = new Set(input.next)
  return {
    enable: input.next.filter(api => !before.has(api)),
    disable: input.previous.filter(
      api => !after.has(api) && input.selected.includes(api)
    ),
  }
}
