/**
 * 在线源的纯规则：片名匹配、来源去重、按来源类型拆分、按站点分组。
 * 渲染层详情页与服务端选源（src/server/view/sources.ts）共用。
 */
import type { CmsItem, EpisodeGroup } from './types'

export type SourceType = 'cms' | 'catspider'

/** 一个站点及其下的多条线路。 */
export interface SiteGroup {
  siteName: string
  lines: EpisodeGroup[]
}

/** 片名归一化：小写、去掉各类括号里的内容、只留字母和数字。 */
export const normalizeTitle = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|（[^）]*）/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')

/** 搜索结果是否算同一部片：归一化后相等或互相包含（任一为空都不算）。 */
export const titleMatches = (title: string, target: string): boolean =>
  !!title &&
  !!target &&
  (title === target || title.includes(target) || target.includes(title))

/** 来源去重键：每个站点只取一条，避免同一站点重复请求和重复线路。 */
export const sourceKey = (
  value: Partial<
    Pick<CmsItem, '_source' | '_siteName' | 'api_url' | 'vod_id'>
  > | null
): string =>
  `${value?._source || 'unknown'}:${value?._siteName || value?.api_url || value?.vod_id || ''}`

/** 按来源类型拆开；没有 _source 的线路归 CMS。 */
export const splitBySourceType = (
  groups: EpisodeGroup[]
): { catspider: EpisodeGroup[]; cms: EpisodeGroup[] } => ({
  catspider: groups.filter(g => g._source === 'catspider'),
  cms: groups.filter(g => g._source === 'cms' || !g._source),
})

/** 有插件线路时优先展示插件源。 */
export const preferredSourceType = (groups: EpisodeGroup[]): SourceType =>
  groups.some(g => g._source === 'catspider') ? 'catspider' : 'cms'

/** 来源类型切换项（只列出有线路的类型，插件在前）。 */
export const sourceTypeOptions = (
  catspider: number,
  cms: number
): { value: SourceType; label: string }[] => [
  ...(catspider
    ? [{ value: 'catspider' as const, label: `插件源 · ${catspider}` }]
    : []),
  ...(cms ? [{ value: 'cms' as const, label: `CMS 源 · ${cms}` }] : []),
]

/** 线路按站点归组（站点名缺失时用线路名），保持首次出现的顺序。 */
export const groupBySite = (groups: EpisodeGroup[]): SiteGroup[] => {
  const map = new Map<string, EpisodeGroup[]>()
  for (const g of groups) {
    const key = g._siteName || g.label
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(g)
  }
  return Array.from(map.entries()).map(([siteName, lines]) => ({
    siteName,
    lines,
  }))
}
