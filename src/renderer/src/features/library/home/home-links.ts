/**
 * 媒体库给首页的出口：最近入库的条目（「最近添加」一排海报）和 Hero 轮播要的整页信息
 * （剧照原图、标志图、简介、元信息、规格标签、想看登记），以及条目详情的路由（播放用 playLibraryItem）。
 * 只读：经 bridge 的 query / getItem 取数，不改片库状态。只取 TMDB 来源的媒体库（番号库不上首页）。
 */
import type { SpecBadge } from '@/components/ui/spec-badge'
import type { WatchlistMeta } from '@/features/watchlist'
import type {
  LibraryItemSummary,
  TopLevelItemType,
} from '../../../../../shared/library/ipc'

import { libraryBridge } from '../api/bridge'
import { heroImage, itemImage } from '../api/images'
import { watchlistMetaOf } from '../detail/playback'
import {
  certificationOf,
  highlightMeta,
  highlightSpecs,
  videoNamesOf,
} from './highlight-rules'

/** Hero 的一页：一部最近入库、有背景图的片子。 */
export interface LibraryHighlight {
  id: number
  type: TopLevelItemType
  title: string
  /** 背景图原图 */
  backdrop: string
  /** 透明底片名标志图；没有时 Hero 用大号片名 */
  logo: string | null
  overview: string
  /** 年份 · 类型 · 时长（或季数） */
  meta: string[]
  specs: SpecBadge[]
  watchlist: WatchlistMeta
}

/** 「最近添加」的一张海报。 */
export interface RecentLibraryItem {
  id: number
  type: TopLevelItemType
  title: string
  year: number | null
  poster: string | null
  rating: number | null
}

/** Hero 从最近入库的前多少条里挑有背景图的。 */
const HIGHLIGHT_POOL = 12

/** 最近入库的条目（新的在前）；没有片库 bridge 或查询失败时为空数组。 */
async function recentSummaries(limit: number): Promise<LibraryItemSummary[]> {
  const bridge = libraryBridge()
  if (!bridge) return []
  try {
    const result = await bridge.query({
      source: 'tmdb',
      sort: 'addedAt',
      order: 'desc',
      limit,
      offset: 0,
    })
    return result.items
  } catch {
    return []
  }
}

const topLevel = (type: string): TopLevelItemType =>
  type === 'series' ? 'series' : 'movie'

/** 「最近添加」：最近入库的海报（缩略图地址）。 */
export async function recentLibraryItems(
  limit = 20
): Promise<RecentLibraryItem[]> {
  return (await recentSummaries(limit)).map(item => ({
    id: item.id,
    type: topLevel(item.type),
    title: item.title,
    year: item.year,
    poster: itemImage(item.poster, 300),
    rating: item.rating,
  }))
}

/** Hero 轮播：最近入库、有背景图的前 count 部，带详情里的简介、标志图和规格。 */
export async function libraryHighlights(
  count = 5
): Promise<LibraryHighlight[]> {
  const bridge = libraryBridge()
  if (!bridge) return []
  const picks = (await recentSummaries(HIGHLIGHT_POOL))
    .filter(item => item.backdrop)
    .slice(0, count)
  const nodes = await Promise.all(
    picks.map(item => bridge.getItem(item.id).catch(() => null))
  )
  return nodes.flatMap(node => {
    const backdrop = node ? heroImage(node.backdrop) : null
    if (!node || !backdrop) return []
    return [
      {
        id: node.id,
        type: topLevel(node.type),
        title: node.title,
        backdrop,
        logo: itemImage(node.logo, 780),
        overview: node.overview ?? '',
        meta: highlightMeta(node),
        specs: highlightSpecs({
          certification: certificationOf(node),
          videoRange: node.videoRange,
          fileNames: videoNamesOf(node),
        }),
        watchlist: watchlistMetaOf(node),
      },
    ]
  })
}

/** 条目详情的路由（片库页按 ?item= 打开详情）。 */
export function libraryItemLocation(
  type: TopLevelItemType,
  id: number
): { path: string; query: { item: string } } {
  return {
    path: type === 'series' ? '/tv' : '/movie',
    query: { item: String(id) },
  }
}
