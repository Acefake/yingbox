/**
 * 首页下半部的数据：热门电影 / 热门剧集两排货架、按类型浏览大卡的背景、精选片单卡的海报。
 *
 * - 热门货架：每个分类一份独立的豆瓣浏览状态（不记条件），与浏览页那份（useDoubanFeed）互不影响，
 *   在浏览页里改筛选不会换掉首页货架和 Hero。
 * - 类型 / 片单预览：只取该条件第一页的前几部，按条件缓存在模块里（回首页不重取；引擎另有 10 分钟页缓存）；
 *   由卡片滚进视口时再取（whenVisible），首屏不多发请求。失败留空，卡片显示渐变占位，下次进入首页再试。
 */
import { type Ref, onBeforeUnmount, onMounted, ref } from 'vue'

import {
  type DoubanKind,
  type DoubanQuery,
  defaultDoubanQuery,
} from '../../../../../shared/douban/query'
import { doubanBrowse, onlineAvailable } from '../api/online'
import type { DoubanItem } from '../types'
import { enrichFromTmdb } from '../utils/douban-tmdb'
import {
  type DoubanFeed,
  createDoubanFeed,
  doubanItemOf,
} from './use-douban-feed'

const hotFeeds: Partial<Record<DoubanKind, DoubanFeed>> = {}

/** 热门电影 / 剧集货架的数据（每个分类全窗口一份） */
export function useHotFeed(kind: DoubanKind): DoubanFeed {
  return (hotFeeds[kind] ??= createDoubanFeed({
    browse: doubanBrowse,
    enrich: enrichFromTmdb,
    storage: null,
    initial: defaultDoubanQuery(kind),
  }))
}

/** 一组条件的预览：null 还没取到 */
const previews = new Map<string, Ref<DoubanItem[] | null>>()
const loading = new Set<string>()

/** 取数（测试替换） */
export interface PreviewDeps {
  browse: typeof doubanBrowse
  enrich: (items: DoubanItem[], kind: DoubanKind) => unknown
}

const defaultDeps: PreviewDeps = {
  browse: doubanBrowse,
  enrich: enrichFromTmdb,
}

/**
 * 某组条件的前 count 部（用作卡片背景 / 扇形海报）。
 * @returns items：还没取到为 null；load：取一次（已取到或正在取时什么也不做）
 */
export function useDoubanPreview(
  query: DoubanQuery,
  count: number,
  deps: PreviewDeps = defaultDeps
): { items: Ref<DoubanItem[] | null>; load: () => Promise<void> } {
  const key = JSON.stringify(query)
  let items = previews.get(key)
  if (!items) previews.set(key, (items = ref<DoubanItem[] | null>(null)))
  const target = items
  const load = async (): Promise<void> => {
    if (target.value?.length || loading.has(key)) return
    loading.add(key)
    try {
      const page = await deps.browse(query, 0)
      target.value = page.items.slice(0, count).map(doubanItemOf)
      // 补全（TMDB 剧照 / 海报）改的是响应式数组里的元素
      void deps.enrich(target.value, query.kind)
    } catch (error) {
      console.warn('[douban] 预览失败', error)
    } finally {
      loading.delete(key)
    }
  }
  return { items: target, load }
}

/** 测试用：清空预览缓存 */
export function resetDoubanPreviews(): void {
  previews.clear()
  loading.clear()
}

/** 条目的背景图：TMDB 剧照，没有就海报 / 豆瓣封面 */
export const artOf = (item: DoubanItem | undefined): string =>
  item ? item.backdrop || item.cover || item.coverSrc : ''

/** 条目的竖版海报：TMDB 海报，补全前用豆瓣封面 */
export const posterOf = (item: DoubanItem | undefined): string =>
  item ? item.cover || item.coverSrc : ''

/**
 * 元素第一次进入视口（含提前 200px）时调用 fn，只调一次；没有 IntersectionObserver 或在线不可用时直接调 / 不调。
 */
export function whenVisible(el: Ref<HTMLElement | null>, fn: () => void): void {
  let observer: IntersectionObserver | null = null
  onMounted(() => {
    if (!onlineAvailable()) return
    if (typeof IntersectionObserver === 'undefined' || !el.value) {
      fn()
      return
    }
    observer = new IntersectionObserver(
      entries => {
        if (!entries.some(e => e.isIntersecting)) return
        observer?.disconnect()
        observer = null
        fn()
      },
      { rootMargin: '200px' }
    )
    observer.observe(el.value)
  })
  onBeforeUnmount(() => observer?.disconnect())
}
