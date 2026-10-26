/**
 * 结果卡 / 搜索结果行要的片库条目信息：说明行（年份 · 类型 · 时长或季数）、规格标签、评分、想看登记、详情路由。
 *
 * 规格标签与首页 Hero 同一套（highlightSpecs：分级圆标 + spec-badge.ts 的 mediaSpecs），数据来自条目详情树
 * （探测到的动态范围 + 视频文件名）。详情树按 id 取一次后缓存（最多 {@link CARD_INFO_CACHE} 条，同一 id 并发只取一次），
 * 输入时反复出现的结果不再请求。
 */
import { type ShallowRef, onScopeDispose, shallowRef, watch } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import type { SpecBadge } from '@/components/ui/spec-badge'
import type { WatchlistMeta } from '@/features/watchlist'

import { libraryBridge } from '../api/bridge'
import {
  certificationOf,
  highlightMeta,
  highlightSpecs,
  videoNamesOf,
} from '../home/highlight-rules'
import { formatRating } from '../../../../../shared/library/rating'
import { continueMetaOf, watchlistMetaOf } from './playback'

/** 最多缓存几条 */
export const CARD_INFO_CACHE = 64

/** 一条片库条目的卡片信息 */
export interface LibraryCardInfo {
  id: number
  /** 年份 · 类型 · 时长或季数 */
  meta: string[]
  specs: SpecBadge[]
  /** 评分文字（一位小数）；没有为空串 */
  rating: string
  watchlist: WatchlistMeta
  /** 打开详情的路由（所在分区页 + ?item=） */
  location: { path: string; query: { item: string } }
}

/** 条目详情树 → 卡片信息（纯规则） */
export function cardInfoOf(node: LibraryItemNode): LibraryCardInfo {
  const { section } = continueMetaOf(node)
  return {
    id: node.id,
    meta: highlightMeta(node),
    specs: highlightSpecs({
      certification: certificationOf(node),
      videoRange: node.videoRange,
      fileNames: videoNamesOf(node),
    }),
    rating: formatRating(node.rating, node.ratingSource),
    watchlist: watchlistMetaOf(node),
    location: { path: `/${section}`, query: { item: String(node.id) } },
  }
}

const cache = new Map<number, Promise<LibraryCardInfo | null>>()

/**
 * 按 id 取卡片信息（缓存）；没有片库、条目不存在或读失败时为 null（失败的不缓存，下次再试）。
 * @param id 片库条目 id
 */
export function libraryCardInfo(id: number): Promise<LibraryCardInfo | null> {
  const hit = cache.get(id)
  if (hit) return hit
  const bridge = libraryBridge()
  if (!bridge) return Promise.resolve(null)
  const pending = bridge.getItem(id).then(
    node => (node ? cardInfoOf(node) : null),
    () => {
      cache.delete(id)
      return null
    }
  )
  cache.set(id, pending)
  if (cache.size > CARD_INFO_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return pending
}

/** 搜索结果停多久再取卡片信息（继续打字就不取） */
export const CARD_INFO_DELAY_MS = 200

/**
 * 一组结果的卡片信息（响应式）：结果停 {@link CARD_INFO_DELAY_MS} 后按需取，取到一条显示一条；
 * 只取前 limit 条（列表上方看得到的），不阻塞输入。
 * @param ids 结果的条目 id（按显示顺序）
 * @param limit 最多取几条
 */
export function useLibraryCardInfos(
  ids: () => readonly number[],
  limit = 8
): ShallowRef<ReadonlyMap<number, LibraryCardInfo>> {
  const infos = shallowRef<ReadonlyMap<number, LibraryCardInfo>>(new Map())
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(
    () => ids().slice(0, limit).join(','),
    () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        for (const id of ids().slice(0, limit)) {
          if (infos.value.has(id)) continue
          void libraryCardInfo(id).then(info => {
            if (!info) return
            infos.value = new Map(infos.value).set(id, info)
          })
        }
      }, CARD_INFO_DELAY_MS)
    },
    { immediate: true }
  )
  onScopeDispose(() => clearTimeout(timer))
  return infos
}
