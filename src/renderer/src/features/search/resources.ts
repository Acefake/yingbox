import type { LibraryItemSummary } from '../../../../shared/library/ipc'
import type { CmsItem } from '@/features/online'
import type {
  MagnetItem,
  NetdiskItem,
} from '../../../../shared/contract/pan115'
import { parseMediaPath } from '../../../../shared/library/parser/parse-path'
import type { SearchResource, WorkKind } from './types'

export function localResource(
  item: LibraryItemSummary,
  reason = '片库匹配'
): SearchResource {
  return {
    key: `local:${item.id}`,
    kind: 'local',
    title: item.title,
    workTitle: item.title,
    aliases: item.originalTitle ? [item.originalTitle] : [],
    year: item.year ?? undefined,
    type: item.type === 'movie' ? 'movie' : 'series',
    tmdbId: item.providerIds.tmdb,
    image: item.poster,
    sources: ['片库'],
    reason,
    interpreted: reason.startsWith('AI 理解'),
    local: item,
  }
}
export function onlineResource(item: CmsItem): SearchResource {
  const type: WorkKind | undefined = /电影/.test(item.type_name)
    ? 'movie'
    : /剧|连续|动漫|综艺/.test(item.type_name)
      ? 'series'
      : undefined
  return {
    key: `online:${item.api_url || item._siteName || item.source_name}:${item.vod_id}`,
    kind: 'online',
    title: `${item.vod_name} ${item.vod_remarks}`,
    workTitle: item.vod_name,
    year: /^\d{4}$/.test(item.vod_year) ? Number(item.vod_year) : undefined,
    type,
    image: item.vod_pic,
    sources: [item.source_name || item._siteName || '在线源'],
    reason: '未验证播放状态',
    online: item,
  }
}
export function externalResource(
  item: NetdiskItem | MagnetItem
): SearchResource {
  const parsed = parseMediaPath(item.title)
  const share = 'shareCode' in item
  return {
    key: share
      ? `share:${item.shareCode}`
      : `${item.kind}:${item.hash.toLowerCase()}`,
    kind: share ? 'share' : 'magnet',
    title: item.title,
    workTitle: parsed.title || item.title,
    aliases: parsed.altTitle ? [parsed.altTitle] : [],
    year: parsed.year,
    // 分享标题未声明电影时，不把没有集号当成电影证据。
    type:
      parsed.type === 'episode'
        ? 'series'
        : /电影/.test(item.title)
          ? 'movie'
          : undefined,
    sources: [item.source],
    reason: share ? '115 分享 · 未验证' : '需 115 离线下载 · 未验证',
    ...(share ? { share: item } : { magnet: item }),
  }
}
