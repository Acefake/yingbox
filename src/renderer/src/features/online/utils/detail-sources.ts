/**
 * 在线详情页的纯规则：独立播放窗的连播队列与同集备用线路、播放历史合并。
 * 片名匹配、来源去重、按站点分组在 shared/online/sources.ts（服务端选源也用）。
 */
import type { PlayerSourceItem } from '@/features/player'
import type { SiteGroup } from '../../../../../shared/online/sources'
import type { EpisodeGroup, OnlinePlayRecord } from '../types'

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
 * 同集其它线路：当前线路卡顿 / 播放失败时按顺序自动尝试。
 * 顺序跟随 siteGroups（详情页已按测速排好），当前站点的其它线路排在别的站点之后（同站多半同一 CDN）。
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
  const isCurrent = (sg: SiteGroup): boolean =>
    !!currentLine && sg.lines.includes(currentLine)
  const ordered = [
    ...siteGroups.filter(sg => !isCurrent(sg)),
    ...siteGroups.filter(isCurrent),
  ]
  for (const sg of ordered) {
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
const historyEntryKey = (entry: OnlinePlayRecord): string =>
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
  history: OnlinePlayRecord[],
  record: OnlinePlayRecord,
  mediaKey: string
): OnlinePlayRecord[] =>
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
