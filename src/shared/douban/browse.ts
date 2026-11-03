/**
 * 浏览页的目标：热门（全部类型）、某个类型、某个精选片单，以及它们的基础查询条件和标题。
 * 桌面浏览页（路由换算在 features/online/utils/browse-target.ts）与服务端 view.browse 共用。
 */
import {
  type CollectionId,
  collectionOf,
  collectionQuery,
  genreQuery,
} from './collections'
import { type DoubanKind, type DoubanQuery, defaultDoubanQuery } from './query'

/** 浏览页显示什么 */
export type BrowseTarget =
  | { type: 'hot'; kind: DoubanKind }
  | { type: 'genre'; genre: string; kind: DoubanKind }
  | { type: 'list'; list: CollectionId }

/** 目标的基础查询条件（刚进入浏览页时） */
export function baseQuery(target: BrowseTarget): DoubanQuery {
  if (target.type === 'list') return collectionQuery(collectionOf(target.list))
  if (target.type === 'genre') return genreQuery(target.genre, target.kind)
  return defaultDoubanQuery(target.kind)
}

/** 浏览页大标题 */
export function browseTitle(target: BrowseTarget): string {
  if (target.type === 'list') return collectionOf(target.list).title
  if (target.type === 'genre') return target.genre
  return '全部'
}
