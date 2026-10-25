/**
 * 首页豆瓣卡的「找 115 资源」入口：把豆瓣卡转成库外发现的条目，打开共用的候选面板弹窗。
 *
 * 库外发现 feature 反过来要用在线的豆瓣 / TMDB 请求，所以这里一律动态 import，避免两个 feature 静态互相引用。
 * 只在桌面端、电影卡上出现（剧集第一版不支持）。
 */
import { ref } from 'vue'

import type { DiscoverTitle } from '@/features/discover'

import type { DoubanItem } from '../types'

/** 当前平台能否找 115 资源（加载库外发现模块后才知道） */
export const doubanDiscoverReady = ref(false)

let loading: Promise<void> | null = null

/** 首页挂载时调一次：按需加载库外发现模块，确认桌面端可用 */
export function loadDoubanDiscover(): Promise<void> {
  loading ??= import('@/features/discover')
    .then(m => void (doubanDiscoverReady.value = m.discoverAvailable))
    .catch(() => void (doubanDiscoverReady.value = false))
  return loading
}

/** 豆瓣卡 → 库外发现条目（新拼的普通对象） */
export function discoverTitleOf(item: DoubanItem): DiscoverTitle {
  const year = item.year.trim()
  return {
    doubanId: /subject\/(\d+)/.exec(item.url)?.[1] ?? item.url,
    kind: item.kind === 'tv' ? 'tv' : 'movie',
    title: item.title,
    originalTitle: item.original_title || '',
    year: /^\d{4}$/.test(year) ? Number(year) : null,
    rate: item.rate,
    cover: item.coverSrc || item.cover,
    tmdbId: null,
  }
}

/** 打开这张豆瓣卡的「找 115 资源」面板 */
export async function openDoubanDiscover(item: DoubanItem): Promise<void> {
  const { openDiscoverDialog } = await import('@/features/discover')
  await openDiscoverDialog(discoverTitleOf(item))
}
