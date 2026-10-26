/**
 * 在线首页「收藏」（localStorage media_favorites）：全应用一份响应式列表。
 * 首页豆瓣卡片的心形和「我的收藏」页的清空都改这一份，在线页用 v-show 切页时两边不会各拿一份旧数据
 * （否则清空后回首页再收藏一部，会把清掉的条目一起写回去）。
 */
import { type Ref, ref } from 'vue'

import { readStoredArray, removeStored, saveStoredArray } from '@/utils/storage'

import type { DoubanItem } from '../types'

export const FAVORITES_KEY = 'media_favorites'

let state: Ref<DoubanItem[]> | null = null

/** 收藏列表（新收藏在前）。 */
export function favoriteItems(): Ref<DoubanItem[]> {
  state ??= ref(readStoredArray<DoubanItem>(FAVORITES_KEY))
  return state
}

/** 是否已收藏（按豆瓣链接比对）。 */
export function isFavorite(item: DoubanItem): boolean {
  return favoriteItems().value.some(entry => entry.url === item.url)
}

/** 收藏 / 取消收藏。 */
export function toggleFavorite(item: DoubanItem): void {
  const list = favoriteItems()
  list.value = isFavorite(item)
    ? list.value.filter(entry => entry.url !== item.url)
    : [item, ...list.value]
  saveStoredArray(FAVORITES_KEY, list.value)
}

/** 清空全部收藏。 */
export function clearFavorites(): void {
  favoriteItems().value = []
  removeStored(FAVORITES_KEY)
}
