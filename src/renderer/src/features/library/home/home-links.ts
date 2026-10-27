/**
 * 媒体库给首页的出口：最近入库的条目（「刚入库」一排横卡）和 Hero 轮播要的整页信息
 * （剧照原图、标志图、简介、元信息、规格标签、评分、想看登记），以及条目详情的路由（播放用 playLibraryItem）。
 * 只读：经 bridge 的 query / getItem 取数，不改片库状态。只取 TMDB 来源的媒体库（番号库不上首页）。
 */
import type { SpecBadge } from '@/components/ui/spec-badge'
import type { WatchlistMeta } from '@/features/watchlist'
import type {
  LibraryItemNode,
  LibraryItemSummary,
  TopLevelItemType,
} from '../../../../../shared/library/ipc'
import { formatRating } from '../../../../../shared/library/rating'

import { libraryBridge } from '../api/bridge'
import { heroImage, itemImage } from '../api/images'
import { watchlistMetaOf } from '../detail/playback'
import {
  certificationOf,
  highlightMeta,
  highlightSpecs,
  videoNamesOf,
} from './highlight-rules'
import { qualityBadge } from './recent-rules'

/** Hero 的一页：一部最近入库、有背景图的片子。 */
export interface LibraryHighlight {
  id: number
  type: TopLevelItemType
  title: string
  /** 背景图原图 */
  backdrop: string
  /** 背景图缩略图（Hero 右下的缩略图条）；取不到时用原图 */
  thumb: string
  /** 透明底片名标志图；没有时 Hero 用大号片名 */
  logo: string | null
  overview: string
  /** 年份 · 类型 · 时长（或季数） */
  meta: string[]
  specs: SpecBadge[]
  /** 「豆瓣 8.3」「TMDB 7.9」；没有评分为空串 */
  rating: string
  watchlist: WatchlistMeta
}

/** 「刚入库」的一张横卡。 */
export interface RecentLibraryItem {
  id: number
  type: TopLevelItemType
  title: string
  year: number | null
  poster: string | null
  /** 横版背景图（缩略图）；没有时卡片用海报 */
  backdrop: string | null
  /** 入库时间（毫秒） */
  addedAt: number
  /** 右上角画质角标（4K / 1080P，或杜比视界 / HDR）；认不出为 null */
  quality: SpecBadge | null
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
  } catch (error) {
    console.warn('[home] 刚入库查询失败', error)
    return []
  }
}

const topLevel = (type: string): TopLevelItemType =>
  type === 'series' ? 'series' : 'movie'

/**
 * 「刚入库」：最近入库的条目和横版背景图，一次列表查询就返回（不等详情，先出卡）；
 * 画质角标要看视频文件名，由 recentQualities 逐条取详情后补上。
 */
export async function recentLibraryItems(
  limit = 12
): Promise<RecentLibraryItem[]> {
  return (await recentSummaries(limit)).map(item => ({
    id: item.id,
    type: topLevel(item.type),
    title: item.title,
    year: item.year,
    poster: itemImage(item.poster, 300),
    backdrop: itemImage(item.backdrop, 780),
    addedAt: item.addedAt,
    quality: qualityBadge([], item.videoRange),
  }))
}

/** 逐条取详情算画质角标（4K / 1080P，或杜比视界 / HDR）；取不到的保留列表里的角标 */
export async function recentQualities(
  items: readonly RecentLibraryItem[]
): Promise<Array<SpecBadge | null>> {
  const bridge = libraryBridge()
  return Promise.all(
    items.map(async item => {
      const node = bridge
        ? await bridge.getItem(item.id).catch(() => null)
        : null
      return node
        ? (qualityBadge(videoNamesOf(node), node.videoRange) ?? item.quality)
        : item.quality
    })
  )
}

/** 详情树 → Hero 的一页；没有背景图时为 null */
function toHighlight(node: LibraryItemNode): LibraryHighlight | null {
  const backdrop = heroImage(node.backdrop)
  if (!backdrop) return null
  return {
    id: node.id,
    type: topLevel(node.type),
    title: node.title,
    backdrop,
    thumb: itemImage(node.backdrop, 300) ?? backdrop,
    logo: itemImage(node.logo, 780),
    overview: node.overview ?? '',
    meta: highlightMeta(node),
    specs: highlightSpecs({
      certification: certificationOf(node),
      videoRange: node.videoRange,
      fileNames: videoNamesOf(node),
    }),
    rating: formatRating(node.rating, node.ratingSource),
    watchlist: watchlistMetaOf(node),
  }
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
    const highlight = node ? toHighlight(node) : null
    return highlight ? [highlight] : []
  })
}

/** 某一部片库条目的 Hero 信息（首页 Hero 第一张放没看完的片子）；没有片库、取不到或没有背景图时为 null。 */
export async function libraryHighlight(
  id: number
): Promise<LibraryHighlight | null> {
  const node = await libraryBridge()
    ?.getItem(id)
    .catch(() => null)
  return node ? toHighlight(node) : null
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
