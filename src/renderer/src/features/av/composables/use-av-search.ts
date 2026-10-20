/**
 * AV 聚合搜索：同时检索全部启用的 AV CMS 源与成人插件源（限并发），
 * 每个站点返回后立即按片名合并展示；结果按「关键词 + 站点集合」缓存 5 分钟。
 */
import { type ComputedRef, computed, ref, shallowRef } from 'vue'
import { type CatSpiderSite, getJson, useVODParser } from '@/features/online'
import { mapWithConcurrency } from '@/utils/concurrency'
import type { AvSite } from './use-av-sources'
import {
  type MergedGroup,
  mergeByTitle,
  parsePluginSearchList,
  searchCacheKey,
  titleKey,
} from '../utils/av-playback'
import { toCmsItems, toPluginItems } from '../utils/av-catalog'

const SEARCH_CACHE_TTL = 5 * 60 * 1000
const SEARCH_CACHE_LIMIT = 30

export function useAvSearch(options: {
  cmsSources: () => AvSite[]
  pluginSources: ComputedRef<CatSpiderSite[]>
  cmsCount: () => number
}) {
  const { search: vodSearch } = useVODParser()
  const keyword = ref('')
  const videos = shallowRef<any[]>([])
  const loading = ref(false)
  const hasSearched = ref(false)
  const doneCount = ref(0)
  const failedCount = ref(0)
  const error = ref('')
  const groups = shallowRef<MergedGroup[]>([])
  const sourceCount = computed(
    () => options.cmsCount() + options.pluginSources.value.length
  )
  let groupMap = new Map<string, MergedGroup>()
  let abort: AbortController | null = null
  const cache = new Map<string, { expiresAt: number; items: any[] }>()

  const rebuild = () => {
    groupMap = mergeByTitle(videos.value)
    groups.value = Array.from(groupMap.values())
  }

  /** 按片名找合并组（播放时用来确定可切换的备用来源）。 */
  const findGroup = (name: string): MergedGroup | null =>
    groupMap.get(titleKey(name)) || null

  /** 单个 CMS 站点：失败计入 failedCount，返回空。 */
  const fetchCms = async (source: AvSite, kw: string, signal: AbortSignal) => {
    try {
      const url = kw
        ? `${source.api}?ac=detail&wd=${encodeURIComponent(kw)}`
        : `${source.api}?ac=detail`
      const data = await getJson<any>(url, { timeoutMs: 8000 })
      if (signal.aborted) return []
      if (data.code === 1 && Array.isArray(data.list))
        return toCmsItems(data.list, source.name)
    } catch {
      if (!signal.aborted) failedCount.value++
    }
    return []
  }

  /** 插件源搜索：走 CatSpider 的 search 动作，返回条目仍需 fetchDetail 才能拿到线路。 */
  const fetchPlugin = async (
    site: CatSpiderSite,
    kw: string,
    signal: AbortSignal
  ) => {
    try {
      const r = await vodSearch({ siteName: site.name, keyword: kw }, signal)
      if (!r.success || !r.data) {
        if (!signal.aborted) failedCount.value++
        return []
      }
      return toPluginItems(parsePluginSearchList(r.data), site.name)
    } catch {
      if (!signal.aborted) failedCount.value++
      return []
    }
  }

  const search = async () => {
    const kw = keyword.value.trim()
    if (!kw) {
      hasSearched.value = true
      error.value = '请输入番号或关键词'
      return
    }
    abort?.abort()
    abort = new AbortController()
    const signal = abort.signal
    loading.value = true
    hasSearched.value = true
    doneCount.value = 0
    failedCount.value = 0
    error.value = ''
    videos.value = []
    rebuild()

    const cmsSources = options.cmsSources()
    const pluginSources = options.pluginSources.value
    const key = searchCacheKey(kw, [
      ...cmsSources.map(source => source.api),
      ...pluginSources.map(site => site.api),
    ])
    const cached = cache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      videos.value = cached.items
      doneCount.value = cmsSources.length + pluginSources.length
      rebuild()
      loading.value = false
      return
    }

    // 每个站点返回后立即合并结果，不等待全部站点完成。
    const collect = async (items: any[]) => {
      if (!signal.aborted) {
        doneCount.value++
        if (items.length) {
          videos.value = [...videos.value, ...items]
          rebuild()
        }
      }
      return items
    }
    const [cmsResults, pluginResults] = await Promise.all([
      mapWithConcurrency(cmsSources, 4, async source =>
        collect(await fetchCms(source, kw, signal))
      ),
      mapWithConcurrency(pluginSources, 3, async site =>
        collect(await fetchPlugin(site, kw, signal))
      ),
    ])
    if (signal.aborted) return
    // 增量结果已经渲染；这里仅用于缓存，避免最后一次重复重建。
    const allItems = [...cmsResults.flat(), ...pluginResults.flat()]
    cache.set(key, {
      expiresAt: Date.now() + SEARCH_CACHE_TTL,
      items: allItems,
    })
    if (cache.size > SEARCH_CACHE_LIMIT)
      cache.delete(cache.keys().next().value as string)
    loading.value = false
    if (allItems.length === 0 && failedCount.value > 0)
      error.value = '已启用的数据源暂时均不可用'
  }

  /** 清空搜索（路由去掉 ?q= 时）。 */
  const reset = () => {
    keyword.value = ''
    videos.value = []
    hasSearched.value = false
    error.value = ''
  }

  return {
    keyword,
    loading,
    hasSearched,
    doneCount,
    error,
    groups,
    sourceCount,
    findGroup,
    search,
    reset,
    dispose: () => abort?.abort(),
  }
}
