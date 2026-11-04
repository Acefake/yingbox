/**
 * 源订阅的纯规则：解析远程清单、清洗站点名、生成镜像地址。
 * 支持 LunaTV / MoonTV（`api_site` 对象）与通用 `sites` 数组两种格式。
 */
import type { ApiSite } from '../types'

/** 内置订阅：主源（多家合并，约 100 站）与备源（LunaTV 完整版），固定不可改（ADR-0047）。 */
export const SUBSCRIPTION_URLS: readonly string[] = [
  'https://raw.githubusercontent.com/DaLongZhuaZi/moontv-config/main/config.json',
  'https://raw.githubusercontent.com/hafrey1/LunaTV-config/main/LunaTV-config.json',
]

const CMS_API = /^https?:\/\/.+(?:api\.php\/provide\/vod|api\/json\.php)/i

/** 去重用的站点键：小写主机、去 www.、去路径末尾斜杠。 */
export const siteKey = (api: string): string => {
  try {
    const url = new URL(api)
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`
  } catch {
    return api
  }
}

/** 按站点键去重合并，靠前的分组优先。 */
export const mergeSites = (...groups: ApiSite[][]): ApiSite[] => {
  const seen = new Set<string>()
  const merged: ApiSite[] = []
  for (const site of groups.flat()) {
    const key = siteKey(site.api)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(site)
  }
  return merged
}

/** 去掉名称首尾的表情、装饰符号与多余空白。 */
export const cleanSiteName = (name: string): string =>
  name
    .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
    .replace(/^[\s\-_·|]+|[\s\-_·|]+$/g, '')
    .trim()

const asEntry = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** 订阅解析结果：成人站（`is_adult` 或名称带 🔞）单独分出，归 AV 板块。 */
export interface ParsedSubscription {
  ordinary: ApiSite[]
  adult: ApiSite[]
}

const toSite = (value: unknown): { site: ApiSite; adult: boolean } | null => {
  const entry = asEntry(value)
  if (!entry) return null
  const api = typeof entry.api === 'string' ? entry.api.trim() : ''
  if (!CMS_API.test(api)) return null
  const raw = typeof entry.name === 'string' ? entry.name : ''
  return {
    site: { name: cleanSiteName(raw) || new URL(api).hostname, api },
    adult: entry.is_adult === true || raw.includes('🔞'),
  }
}

/** 解析订阅内容，分出普通站与成人站并各自去重；格式不认识时两组都为空。 */
export const parseSubscription = (raw: unknown): ParsedSubscription => {
  const root = asEntry(raw)
  if (!root) return { ordinary: [], adult: [] }
  const entries = Array.isArray(root.sites)
    ? root.sites
    : Object.values(asEntry(root.api_site) ?? {})
  const ordinary: ApiSite[] = []
  const adult: ApiSite[] = []
  for (const value of entries) {
    const parsed = toSite(value)
    if (parsed) (parsed.adult ? adult : ordinary).push(parsed.site)
  }
  return { ordinary: mergeSites(ordinary), adult: mergeSites(adult) }
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
