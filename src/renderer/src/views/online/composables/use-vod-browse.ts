import { computed, ref } from 'vue'
import { useVODParser } from '@/composables/use-vod-parser'
import type { CatSpiderSite, CmsItem } from '@/views/online/composables/use-online-search'

export interface VodTab {
  name: string
  ext: Record<string, any>
}

export interface VodCard {
  vod_id: string
  vod_name: string
  vod_pic: string
  vod_remarks: string
  type_name: string
  ext: Record<string, any>
  _siteName: string
}

export interface VodSource {
  site: CatSpiderSite
  tabs: VodTab[]
  loaded: boolean
}

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * VOD 分类浏览 composable
 * 管理 CatSpider 源的分类导航、内容卡片列表和分页
 */
export function useVodBrowse() {
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

  const activeSource = computed(() => sources.value[activeSourceIdx.value] || null)
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

        const config = r.data.config || r.data.data?.config || r.data
        const tabList = config.tabs || []
        return {
          site,
          tabs: tabList.map((t: any) => ({
            name: t.name || '',
            ext: t.ext || {},
          })),
          loaded: tabList.length > 0,
        }
      } catch {
        return { site, tabs: [], loaded: false }
      }
    })

    sources.value = results
      .filter(source => source.loaded)

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
    await loadCards(activeSourceIdx.value, activeTabIdx.value, currentPage.value + 1)
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
        url: tab.ext.url,
        ext: JSON.stringify(tab.ext),
        page,
      })

      if (!r.success || !r.data) {
        if (page === 1) cards.value = []
        hasMore.value = false
        return
      }

      const list = r.data.list || r.data.data?.list || []
      const newCards: VodCard[] = list.map((item: any) => ({
        vod_id: item.vod_id || '',
        vod_name: item.vod_name || '',
        vod_pic: item.vod_pic || '',
        vod_remarks: item.vod_remarks || '',
        type_name: item.type_name || item.vod_class || '',
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
