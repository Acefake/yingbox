import { type ComputedRef, type Ref, computed, ref } from 'vue'
import { mapWithConcurrency } from '@/utils/concurrency'
import { asText } from '@/utils/json'
import {
  type PluginExt,
  type PluginTab,
  asRawVod,
  getVodList,
  pluginTabs,
} from '@/utils/vod-data'
import { useVODParser } from './use-vod-parser'
import type { CatSpiderSite, CmsItem } from './use-online-search'

export interface VodCard {
  vod_id: string
  vod_name: string
  vod_pic: string
  vod_remarks: string
  vod_year: string
  type_name: string
  ext: PluginExt
  _siteName: string
}

interface VodSource {
  site: CatSpiderSite
  tabs: PluginTab[]
  loaded: boolean
}

/** 插件源分类浏览的状态与操作 */
export interface UseVodBrowseReturn {
  sources: Ref<VodSource[]>
  activeSourceIdx: Ref<number>
  activeTabIdx: Ref<number>
  activeSource: ComputedRef<VodSource | null>
  activeTabs: ComputedRef<PluginTab[]>
  cards: Ref<VodCard[]>
  loading: Ref<boolean>
  loadingSources: Ref<boolean>
  error: Ref<string>
  currentPage: Ref<number>
  hasMore: Ref<boolean>
  loadSources: (sites: CatSpiderSite[]) => Promise<void>
  switchSource: (idx: number) => Promise<void>
  switchTab: (idx: number) => Promise<void>
  loadMore: () => Promise<void>
  reload: () => Promise<void>
  cardToCmsItem: (card: VodCard) => CmsItem
}

/**
 * VOD 分类浏览 composable
 * 管理 CatSpider 源的分类导航、内容卡片列表和分页
 */
export function useVodBrowse(): UseVodBrowseReturn {
  const { getConfig, getCards } = useVODParser()

  const sources = ref<VodSource[]>([])
  const activeSourceIdx = ref(0)
  const activeTabIdx = ref(0)
  const cards = ref<VodCard[]>([])
  const loading = ref(false)
  const loadingSources = ref(false)
  const error = ref('')
  const currentPage = ref(1)
  const hasMore = ref(true)

  const activeSource = computed(
    () => sources.value[activeSourceIdx.value] || null
  )
  const activeTabs = computed(() => activeSource.value?.tabs || [])

  /**
   * 加载所有 CatSpider 源的分类配置
   */
  const loadSources = async (sites: CatSpiderSite[]): Promise<void> => {
    loadingSources.value = true
    error.value = ''

    const results = await mapWithConcurrency(sites, 4, async site => {
      try {
        const r = await getConfig(site.name)
        if (!r.success || !r.data) return { site, tabs: [], loaded: false }

        const tabs = pluginTabs(r.data)
        return { site, tabs, loaded: tabs.length > 0 }
      } catch {
        return { site, tabs: [], loaded: false }
      }
    })

    sources.value = results.filter(source => source.loaded)

    loadingSources.value = false

    // 自动加载第一个源的第一个分类
    if (sources.value.length > 0) {
      await loadCards(0, 0)
    }
  }

  /**
   * 切换源
   */
  const switchSource = async (idx: number): Promise<void> => {
    activeSourceIdx.value = idx
    activeTabIdx.value = 0
    currentPage.value = 1
    cards.value = []
    hasMore.value = true
    await loadCards(idx, 0, 1)
  }

  /**
   * 切换分类
   */
  const switchTab = async (idx: number): Promise<void> => {
    activeTabIdx.value = idx
    currentPage.value = 1
    cards.value = []
    hasMore.value = true
    await loadCards(activeSourceIdx.value, idx, 1)
  }

  /**
   * 加载更多（下一页）
   */
  const loadMore = async (): Promise<void> => {
    if (!hasMore.value || loading.value) return
    await loadCards(
      activeSourceIdx.value,
      activeTabIdx.value,
      currentPage.value + 1
    )
  }

  /** 重新加载当前数据源和分类，供页面顶部刷新使用。 */
  const reload = async (): Promise<void> => {
    cards.value = []
    currentPage.value = 1
    hasMore.value = true
    await loadCards(activeSourceIdx.value, activeTabIdx.value, 1)
  }

  /**
   * 加载分类下的内容卡片
   */
  const loadCards = async (
    sourceIdx: number,
    tabIdx: number,
    page: number = 1
  ): Promise<void> => {
    const src = sources.value[sourceIdx]
    if (!src) return

    const tab = src.tabs[tabIdx]
    if (!tab) return

    loading.value = true
    error.value = ''

    try {
      const r = await getCards({
        siteName: src.site.name,
        url: asText(tab.ext.url) || undefined,
        ext: JSON.stringify(tab.ext),
        page,
      })

      if (!r.success || !r.data) {
        if (page === 1) cards.value = []
        hasMore.value = false
        return
      }

      const newCards: VodCard[] = getVodList(r.data)
        .map(asRawVod)
        .map(item => ({
          vod_id: asText(item.vod_id),
          vod_name: item.vod_name || '',
          vod_pic: item.vod_pic || '',
          vod_remarks: item.vod_remarks || '',
          vod_year: asText(item.vod_year),
          type_name: item.type_name || asText(item.vod_class),
          ext: item.ext || {},
          _siteName: src.site.name,
        }))

      if (page === 1) {
        cards.value = newCards
      } else {
        cards.value = [...cards.value, ...newCards]
      }

      currentPage.value = page
      hasMore.value = newCards.length > 0
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载失败'
      if (page === 1) cards.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * 将 VodCard 转为 CmsItem（用于打开详情窗口）
   */
  const cardToCmsItem = (card: VodCard): CmsItem => ({
    vod_id: card.vod_id,
    vod_name: card.vod_name,
    type_name: card.type_name,
    vod_year: '',
    vod_remarks: card.vod_remarks,
    vod_pic: card.vod_pic,
    _source: 'catspider',
    _siteName: card._siteName,
    _ext: card.ext,
  })

  return {
    sources,
    activeSourceIdx,
    activeTabIdx,
    activeSource,
    activeTabs,
    cards,
    loading,
    loadingSources,
    error,
    currentPage,
    hasMore,
    loadSources,
    switchSource,
    switchTab,
    loadMore,
    reload,
    cardToCmsItem,
  }
}
