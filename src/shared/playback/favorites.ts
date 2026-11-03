/**
 * 在线收藏（豆瓣卡）的规则：按豆瓣链接比对，新收藏在前。
 * 桌面与网页存在 localStorage（media_favorites），安卓经服务端存在 sqlite。
 */
import type { DoubanItem } from '../douban/item'

/** 是否已收藏 */
export const hasFavorite = (
  list: readonly DoubanItem[],
  url: string
): boolean => list.some(entry => entry.url === url)

/** 收藏 / 取消收藏后的列表 */
export function toggleFavoriteIn(
  list: readonly DoubanItem[],
  item: DoubanItem
): DoubanItem[] {
  return hasFavorite(list, item.url)
    ? list.filter(entry => entry.url !== item.url)
    : [item, ...list]
}

const isText = (value: unknown): value is string => typeof value === 'string'

/** 一张豆瓣卡是否形状完整（外部数据：旧存储、客户端请求） */
export function isDoubanItem(value: unknown): value is DoubanItem {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    [
      'title',
      'searchTitle',
      'original_title',
      'cover',
      'coverSrc',
      'rate',
      'url',
      'year',
      'type',
      'overview',
    ].every(key => isText(v[key])) &&
    (v.kind === undefined || v.kind === 'movie' || v.kind === 'tv') &&
    (v.backdrop === undefined || isText(v.backdrop)) &&
    (v.tmdbRate === undefined || typeof v.tmdbRate === 'number')
  )
}

/** 读回存储时校验：形状不对的丢掉 */
export const parseFavorites = (raw: unknown): DoubanItem[] =>
  Array.isArray(raw) ? raw.filter(isDoubanItem) : []
