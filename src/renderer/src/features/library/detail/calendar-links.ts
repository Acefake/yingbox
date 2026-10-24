/**
 * 媒体库给追剧日历（features/calendar）的出口：查播出数据、播放某一集、换图片地址、文件进度的键。
 * 日历不直接碰 bridge 与详情树，统一经这里，媒体库内部结构变了只改这一个文件。
 */
import type {
  CalendarRequest,
  CalendarResult,
  LibraryItemNode,
} from '../../../../../shared/library/ipc'
import { serverFileUrl } from '@/services/library-server'

import { libraryBridge, usesLibraryServer } from '../api/bridge'
import { itemImage } from '../api/images'
import { episodePlayRequest, play } from './playback'

/** 区间内播出的集；当前窗口没有片库 bridge 时为 null。 */
export function fetchCalendarEpisodes(
  request: CalendarRequest
): Promise<CalendarResult> | null {
  return libraryBridge()?.calendar.episodes(request) ?? null
}

/** 媒体库图片（海报 / 背景图）在界面上的地址。 */
export function libraryImage(url: string | null): string | null {
  return itemImage(url, 780)
}

/** 某个文件的播放进度键：桌面端是文件路径，网页端是片库服务的流地址。 */
export function libraryProgressKey(
  fileId: number | null,
  filePath: string | null
): string | null {
  if (fileId === null) return null
  return usesLibraryServer() ? serverFileUrl(fileId) : filePath
}

/** 剧里的某一集（集挂在季下，或直接挂在剧下）。 */
function findEpisode(
  series: LibraryItemNode,
  season: number,
  episode: number
): { parent: LibraryItemNode; node: LibraryItemNode } | null {
  const parents = [
    ...series.children.filter(
      c => c.type === 'season' && c.seasonNumber === season
    ),
    series,
  ]
  for (const parent of parents) {
    const node = parent.children.find(
      c =>
        c.type === 'episode' &&
        c.episodeNumber === episode &&
        (c.seasonNumber === null || c.seasonNumber === season)
    )
    if (node) return { parent, node }
  }
  return null
}

/** 播放剧里的某一集（按本季顺序连播）；找不到本地文件或打不开播放器返回 false。 */
export async function playLibraryEpisode(
  seriesId: number,
  season: number,
  episode: number
): Promise<boolean> {
  const series = await libraryBridge()?.getItem(seriesId)
  if (!series) return false
  const found = findEpisode(series, season, episode)
  if (!found) return false
  const request = episodePlayRequest(series, found.parent, found.node)
  if (!request) return false
  return play(request, itemImage(series.poster, 300) ?? undefined)
}
