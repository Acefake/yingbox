/**
 * 在线详情页的纯规则：片名匹配、来源去重、站点 → 线路 → 剧集三层分组、
 * 独立播放窗的连播队列与同集备用线路、播放历史合并。
 */
import type { PlayerSourceItem } from '@/features/player'
import type { EpisodeGroup } from '../types'

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
export const sourceKey = (value: any): string =>
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
export const sourceTypeOptions = (catspider: number, cms: number) => [
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

/** 当前线路的播放队列：独立播放窗用它自动连播下一集。 */
export const buildPlaylist = (line?: EpisodeGroup): PlayerSourceItem[] => {
  if (!line?.episodes?.length) return []
  return line.episodes.map(ep => ({
    url: ep.url,
    ...(ep.name ? { name: ep.name } : {}),
    ...(ep.ext ? { ext: ep.ext } : {}),
    ...(line._siteName ? { siteName: line._siteName } : {}),
  }))
}

/**
 * 同集其它线路：当前线路播放失败时自动尝试。
 * 优先按集名匹配；各源命名差异大（"第01集" vs "01"），失败时退化为按集序匹配。
 */
export const buildFallbacks = (
  siteGroups: SiteGroup[],
  currentLine: EpisodeGroup | undefined,
  epName: string,
  epIndex: number
): PlayerSourceItem[] => {
  const out: PlayerSourceItem[] = []
  const seen = new Set<string>()
  for (const sg of siteGroups) {
    for (const line of sg.lines) {
      if (line === currentLine) continue
      const eps = line.episodes || []
      if (!eps.length) continue
      const byName = epName ? eps.find(ep => ep.name === epName) : undefined
      const hit =
        byName ||
        (epIndex >= 0 && epIndex < eps.length ? eps[epIndex] : undefined)
      if (!hit?.url) continue
      const key = `${line.label}|${hit.url}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        url: hit.url,
        name: `${sg.siteName} · ${line.label}`,
        ...(hit.ext ? { ext: hit.ext } : {}),
        ...(line._siteName ? { siteName: line._siteName } : {}),
      })
    }
  }
  return out
}

/** 播放历史里一条记录对应的影片键。 */
const historyEntryKey = (entry: any): string =>
  String(
    entry?.item?.vod_id ||
      entry?.vod_id ||
      entry?.item?.vod_name ||
      entry?.vod_name ||
      entry?.url ||
      ''
  )

/** 新记录放最前；同一部片（或同一地址）只保留这一条，最多 30 条。 */
export const mergeOnlineHistory = (
  history: Record<string, any>[],
  record: Record<string, any>,
  mediaKey: string
): Record<string, any>[] =>
  [
    record,
    ...history.filter(entry => {
      const key = historyEntryKey(entry)
      return key && key !== mediaKey && entry?.url !== record.url
    }),
  ].slice(0, 30)

/** 类型名带「剧」按剧集查 TMDB，否则按电影。 */
export const guessMediaType = (typeName: string): 'movie' | 'tv' =>
  typeName.includes('剧') ? 'tv' : 'movie'

/** TMDB 图片地址；没有路径时返回空串。 */
export const tmdbImage = (size: string, path?: string | null): string =>
  path ? `https://images.tmdb.org/t/p/${size}${path}` : ''
