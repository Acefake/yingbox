/**
 * 媒体库给 AI 助手技能包的出口：按来源查条目、随机取一条、播放条目、取条目的第一个视频文件。
 * 技能包不直接碰 bridge 与详情树，统一经这里。
 */
import type {
  LibraryItemSummary,
  LibrarySource,
} from '../../../../../shared/library/ipc'

import { libraryBridge, usesLibraryServer } from '../api/bridge'
import { itemImage } from '../api/images'
import { play, primaryPlayRequest, videoFiles } from './playback'

/** 查到的一页条目 */
export interface LibraryLookup {
  items: LibraryItemSummary[]
  total: number
}

/**
 * 在某种来源的媒体库里按片名 / 编号搜索（FTS，大小写不敏感）。
 * @returns 没有媒体库 bridge 时为 null
 */
export async function findLibraryItems(
  source: LibrarySource,
  search: string,
  limit = 6
): Promise<LibraryLookup | null> {
  const bridge = libraryBridge()
  if (!bridge) return null
  const result = await bridge.query({ source, search, limit, offset: 0 })
  return { items: result.items, total: result.total }
}

/**
 * 从某种来源的媒体库里随机取一条。
 * @param random 0–1 的随机数（测试可固定）
 */
export async function randomLibraryItem(
  source: LibrarySource,
  random: () => number = Math.random
): Promise<LibraryItemSummary | null> {
  const bridge = libraryBridge()
  if (!bridge) return null
  const head = await bridge.query({ source, limit: 1, offset: 0 })
  if (!head.total) return null
  const offset = Math.min(head.total - 1, Math.floor(random() * head.total))
  if (offset === 0) return head.items[0] ?? null
  const page = await bridge.query({ source, limit: 1, offset })
  return page.items[0] ?? null
}

/** 按条目主播放（电影连播全部文件，剧从第一集）；找不到可播放文件时返回 false */
export async function playLibraryItem(id: number): Promise<boolean> {
  const node = await libraryBridge()?.getItem(id)
  const request = node ? primaryPlayRequest(node) : null
  if (!node || !request) return false
  return play(request, itemImage(node.poster, 780) ?? undefined)
}

/** 电影条目的第一个视频文件路径（只在桌面端、不是片库服务时有） */
export async function libraryItemVideo(id: number): Promise<string | null> {
  if (usesLibraryServer()) return null
  const node = await libraryBridge()?.getItem(id)
  return node?.type === 'movie' ? (videoFiles(node)[0] ?? null) : null
}

/** 条目海报的缩略图地址 */
export function libraryPoster(url: string | null): string | null {
  return itemImage(url, 300)
}
