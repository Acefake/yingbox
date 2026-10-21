/**
 * 在线搜索：并发检索已启用的 CMS 与 CatSpider 站点、取详情线路、解析插件播放地址。
 * 站点清单与启用列表在 ./cms-sites、./catspider-sites；返回数据的解析在 ../utils/vod-payload。
 */
import { getSetting } from '@/features/settings'
import { mapWithConcurrency } from '@/utils/concurrency'
import { asText } from '@/utils/json'
import { firstPlayUrl, getVodList } from '@/utils/vod-data'
import { getCurrentScope, onScopeDispose, ref } from 'vue'
import { getJson } from '../api/online'
import type {
  ApiSite,
  CatSpiderSite,
  CmsItem,
  EpisodeGroup,
  PluginExt,
} from '../types'
import {
  cmsDetailSources,
  parseCatSpiderGroups,
  parseCmsGroups,
  toCatSpiderSearchItems,
  toCmsSearchItems,
} from '../utils/vod-payload'
import {
  CATSPIDER_SITES,
  isAdultCatSpiderSite,
  loadCatSpiderSites,
  selectedCatSpider,
} from './catspider-sites'
import { DEFAULT_SITES, customSites, selectedSites } from './cms-sites'
import { useVODParser } from './use-vod-parser'

export type {
  ApiSite,
  CatSpiderSite,
  CmsItem,
  CmsSource,
  EpisodeGroup,
} from '../types'
export { CATSPIDER_SITES, DEFAULT_SITES, loadCatSpiderSites }

/** 苹果 CMS 列表 / 详情接口的返回（ac=videolist） */
interface CmsListResponse {
  code?: number
  list?: CmsItem[]
}

export function useOnlineSearch() {
  const keyword = ref('')
  const results = ref<CmsItem[]>([])
  const loading = ref(false)
  const error = ref('')
  const { search: vodSearch, getTracks, getPlayinfo } = useVODParser()
  let generation = 0
  let searchController: AbortController | null = null
  if (getCurrentScope())
    onScopeDispose(() => {
      generation++
      searchController?.abort()
    })

  const activeSites = (): ApiSite[] => {
    const all = [...DEFAULT_SITES, ...customSites.value]
    return all.filter(s => selectedSites.has(s.api))
  }

  const activeCatSpiderSites = (): CatSpiderSite[] => {
    const adultMode = getSetting('app.adultMode')
    return CATSPIDER_SITES.value.filter(
      site =>
        selectedCatSpider.value.includes(site.api) &&
        (adultMode || !isAdultCatSpiderSite(site))
    )
  }

  const search = async (
    kw?: string,
    options: { allVod?: boolean; onItems?: (items: CmsItem[]) => void } = {}
  ): Promise<void> => {
    const q = (kw ?? keyword.value).trim()
    if (!q) return
    const requestId = ++generation
    searchController?.abort()
    const controller = new AbortController()
    searchController = controller
    const current = (): boolean =>
      requestId === generation && !controller.signal.aborted
    keyword.value = q
    loading.value = true
    error.value = ''
    results.value = []
    const publish = (items: CmsItem[]): void => {
      if (!current() || !items.length) return
      results.value = [...results.value, ...items]
      options.onItems?.(items)
    }

    // 搜索页可能是应用启动后的第一个入口，必须先加载完整 VOD 配置，
    // 否则只会使用 3 个 fallback 源，表现为“详情只有荐片”。
    try {
      await loadCatSpiderSites()
      if (!current()) return

      const cmsTasks = mapWithConcurrency(activeSites(), 6, async site => {
        if (!current()) return []
        try {
          const url = new URL(site.api)
          url.searchParams.set('ac', 'videolist')
          url.searchParams.set('wd', q)
          const data = await getJson<CmsListResponse>(String(url), {
            timeoutMs: 10000,
          })
          if (!Array.isArray(data?.list)) return []
          const items = toCmsSearchItems(data.list, site)
          publish(items)
          return items
        } catch {
          return []
        }
      })

      // 详情页需要跨源聚合时（allVod），即使用户只勾选了少数源，也尝试全部非成人 VOD 源。
      const csSites = options.allVod
        ? CATSPIDER_SITES.value.filter(site => !isAdultCatSpiderSite(site))
        : activeCatSpiderSites()
      const csTasks = mapWithConcurrency(csSites, 4, async site => {
        if (!current()) return []
        try {
          const r = await vodSearch(
            { siteName: site.name, keyword: q },
            controller.signal
          )
          if (!r.success || !r.data) return []
          const items = toCatSpiderSearchItems(getVodList(r.data), site)
          publish(items)
          return items
        } catch {
          return []
        }
      })

      const [cmsResults, csResults] = await Promise.all([cmsTasks, csTasks])
      // 直接返回所有结果，不去重合并
      if (current()) results.value = [...cmsResults.flat(), ...csResults.flat()]
    } catch (cause) {
      if (current())
        error.value = cause instanceof Error ? cause.message : '搜索失败'
    } finally {
      if (requestId === generation) loading.value = false
    }
  }

  /** 取条目的播放线路：CatSpider 走 getTracks，CMS 并发查各来源的详情接口。 */
  const fetchDetail = async (item: CmsItem): Promise<EpisodeGroup[]> => {
    if (item._source === 'catspider' && item._siteName) {
      try {
        const ext = item._ext || {}
        const url = asText(ext.url) || String(item.vod_id)
        const r = await getTracks({
          siteName: item._siteName,
          url,
          ...ext,
          id: ext.id ?? item.vod_id,
        })
        if (!r.success || !r.data) return []
        return parseCatSpiderGroups(getVodList(r.data), item._siteName)
      } catch {
        return []
      }
    }

    const sources = cmsDetailSources(item)
    if (!sources.length) return []
    const tasks = sources.map(async src => {
      try {
        const url = `${src.api_url}?ac=videolist&ids=${src.vod_id}`
        const data = await getJson<CmsListResponse>(url, { timeoutMs: 10000 })
        return parseCmsGroups(data?.list?.[0], src.source_name)
      } catch {
        return []
      }
    })
    const allGroups = (await Promise.all(tasks)).flat()
    allGroups.sort((a, b) => (b.hasDirect ? 1 : 0) - (a.hasDirect ? 1 : 0))
    return allGroups
  }

  /**
   * 把 CatSpider 剧集地址解析成可播放的 m3u8/mp4。
   * 完整的 ext 传给后端，让插件自行提取所需参数（url/vid/pkey/ref 等）。
   */
  const resolvePlayUrl = async (
    siteName: string,
    ext: PluginExt
  ): Promise<string> => {
    try {
      const r = await getPlayinfo({ siteName, url: asText(ext.url), ...ext })
      if (!r.success || !r.data) return ''
      return firstPlayUrl(r.data)
    } catch {
      return ''
    }
  }

  return {
    keyword,
    results,
    loading,
    error,
    selectedSites,
    customSites,
    DEFAULT_SITES,
    CATSPIDER_SITES,
    selectedCatSpider,
    loadCatSpiderSites,
    isAdultCatSpiderSite,
    activeCatSpiderSites,
    search,
    fetchDetail,
    resolvePlayUrl,
  }
}
