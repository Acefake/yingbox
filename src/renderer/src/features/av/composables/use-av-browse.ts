/**
 * AV 单源分类浏览：数据源 / 分类 / 排序选择（每个源记住上次停留处）、分页加载、
 * 滚动到底自动加载下一页、内存缓存。CMS、插件两种源共用一套请求流程。
 */
import {
  type ComputedRef,
  type Ref,
  type ShallowRef,
  computed,
  nextTick,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useStorage } from '@vueuse/core'
import type { MediaFilterRow } from '@/components/MediaFilterBar.vue'
import { useVODParser } from '@/features/online'
import {
  type AvEntry,
  type AvVideo,
  type BrowseCacheEntry,
  type BrowseCategory,
  type BrowseSort,
  type BrowseVisit,
  allCategories,
  buildFilterRows,
  browseCacheKey as makeCacheKey,
  mergePage,
  parsePluginTabs,
  rememberBounded,
  sortBrowseVideos,
} from '../utils/av-catalog'

import { createPageFetchers } from './av-browse-pages'

const NO_SOURCE_ERROR = '没有启用的数据源，请先在数据源管理中启用一个来源'

/** AV 分类浏览页用到的状态与操作 */
export interface UseAvBrowseReturn {
  scrollEl: Ref<HTMLElement | null>
  videos: ShallowRef<AvVideo[]>
  sortedVideos: ComputedRef<AvVideo[]>
  total: Ref<number>
  loading: Ref<boolean>
  error: Ref<string>
  loadingMore: Ref<boolean>
  moreError: Ref<string>
  hasMore: ComputedRef<boolean>
  currentEntry: ComputedRef<AvEntry | undefined>
  categoryName: Ref<string>
  filterRows: ComputedRef<MediaFilterRow[]>
  filterModel: ComputedRef<{
    source: string
    sort: BrowseSort
    category: string
  }>
  onFilterChange: (value: Record<string, string>) => void
  onScroll: () => void
  load: (force?: boolean, append?: boolean) => Promise<void>
  init: () => Promise<void>
  dispose: () => void
}

export function useAvBrowse(options: {
  entries: ComputedRef<AvEntry[]>
  /** 只有停在「浏览」视图时才滚动加载 */
  isActive: () => boolean
  /** 插件清单就绪前不校正失效数据源，避免把已选插件源误判为失效 */
  ready: Ref<boolean>
}): UseAvBrowseReturn {
  const { getConfig } = useVODParser()
  const sourceApi = useStorage('av_browse_source', '')
  const categoryId = ref<number | null>(null)
  const categoryName = ref('全部')
  const categories = ref<BrowseCategory[]>(allCategories())
  const sort = ref<BrowseSort>('latest')
  const videos = shallowRef<AvVideo[]>([])
  const page = ref(1)
  const pageCount = ref(0)
  const total = ref(0)
  const loading = ref(false)
  const error = ref('')
  const loadingMore = ref(false)
  const moreError = ref('')
  const scrollEl = ref<HTMLElement | null>(null)
  const visits = useStorage<Record<string, BrowseVisit>>('av_browse_visits', {})
  const categoryCache = useStorage<Record<string, BrowseCategory[]>>(
    'av_browse_categories',
    {}
  )
  const cache = new Map<string, BrowseCacheEntry>()
  let abort: AbortController | null = null
  let activeKey = ''

  const currentEntry = computed(() =>
    options.entries.value.find(entry => entry.api === sourceApi.value)
  )
  const isPlugin = computed(() => currentEntry.value?.kind === 'plugin')
  const hasMore = computed(() => page.value < pageCount.value)
  const sortedVideos = computed(() =>
    sortBrowseVideos(videos.value, sort.value)
  )
  const filterRows = computed(() =>
    buildFilterRows(options.entries.value, categories.value)
  )
  const filterModel = computed(() => ({
    source: sourceApi.value,
    sort: sort.value,
    category: categoryName.value,
  }))

  const { fetchPluginPage, fetchCmsPage } = createPageFetchers({
    sourceApi,
    categories,
    categoryId,
    categoryCache,
  })

  const cacheKey = (p: number): string =>
    makeCacheKey({
      sourceApi: sourceApi.value,
      byName: isPlugin.value,
      categoryName: categoryName.value,
      categoryId: categoryId.value,
      page: p,
      sort: sort.value,
    })

  const onScroll = (): void => {
    const el = scrollEl.value
    if (!options.isActive() || !el || loading.value || loadingMore.value) return
    if (moreError.value || !hasMore.value) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400)
      void load(false, true)
  }

  const saveVisit = (): void => {
    if (!sourceApi.value) return
    visits.value[sourceApi.value] = {
      categoryId: categoryId.value,
      categoryName: categoryName.value,
      sort: sort.value,
    }
  }

  const restoreVisit = (): void => {
    const saved = visits.value[sourceApi.value]
    categories.value = categoryCache.value[sourceApi.value] ?? allCategories()
    categoryId.value = saved?.categoryId ?? null
    categoryName.value = saved?.categoryName ?? '全部'
    page.value = 1
    sort.value = saved?.sort ?? 'latest'
  }

  const applyEntry = (
    entry: BrowseCacheEntry,
    append: boolean,
    p: number
  ): void => {
    videos.value = mergePage(videos.value, entry.items, append)
    page.value = p
    pageCount.value = entry.items.length ? entry.pageCount : p
    total.value = entry.total
    categories.value = entry.categories
    if (sourceApi.value) categoryCache.value[sourceApi.value] = entry.categories
  }

  /**
   * 一次分页请求的公共流程：可取消、只认最后一次请求、写缓存、记住停留处、
   * 结束后若仍未填满视口则继续加载。fetchPage 返回的整理函数只在请求仍有效时执行
   * （分类合并等副作用不会落到已切走的数据源上），它或请求抛错即显示错误。
   */
  const runRequest = async (
    p: number,
    append: boolean,
    fetchPage: () => Promise<() => BrowseCacheEntry>,
    clearOnError: boolean
  ): Promise<void> => {
    const controller = new AbortController()
    abort = controller
    activeKey = cacheKey(p)
    loading.value = !append
    loadingMore.value = append
    error.value = ''
    const isCurrent = (): boolean =>
      !controller.signal.aborted && abort === controller
    try {
      const finish = await fetchPage()
      if (!isCurrent()) return
      const entry = finish()
      rememberBounded(cache, cacheKey(p), entry)
      applyEntry(entry, append, p)
      saveVisit()
    } catch (cause) {
      if (!isCurrent()) return
      const text = cause instanceof Error ? cause.message : '加载分类内容失败'
      if (append) moreError.value = text
      else {
        error.value = text
        if (clearOnError) videos.value = []
      }
    } finally {
      if (isCurrent()) {
        loading.value = false
        loadingMore.value = false
        await nextTick()
        if (!error.value && !moreError.value) onScroll()
      }
    }
  }

  /** 加载第一页（force 跳过缓存）或下一页（append）。 */
  const load = async (force = false, append = false): Promise<void> => {
    if (append && (loading.value || loadingMore.value || !hasMore.value)) return
    const p = append ? page.value + 1 : 1
    const source = currentEntry.value
    if (!source) {
      abort?.abort()
      loading.value = false
      loadingMore.value = false
      moreError.value = ''
      videos.value = []
      pageCount.value = 0
      total.value = 0
      error.value = NO_SOURCE_ERROR
      return
    }
    const key = cacheKey(p)
    if (!force && loading.value && activeKey === key) return
    abort?.abort()
    loadingMore.value = false
    moreError.value = ''
    if (!append) {
      videos.value = []
      page.value = 1
      pageCount.value = 0
      if (scrollEl.value) scrollEl.value.scrollTop = 0
    }
    const cached = cache.get(key)
    if (!force && cached) {
      error.value = ''
      applyEntry(cached, append, p)
      loading.value = false
      saveVisit()
      await nextTick()
      onScroll()
      return
    }
    if (isPlugin.value) {
      const ext = categories.value.find(c => c.name === categoryName.value)?.ext
      if (!ext) {
        videos.value = []
        error.value = `${source.name} 暂不支持分类浏览`
        loading.value = false
        loadingMore.value = false
        return
      }
      return runRequest(p, append, () => fetchPluginPage(source, ext, p), true)
    }
    return runRequest(p, append, () => fetchCmsPage(source, p), false)
  }

  /** 切换到插件源时，先取回它的分类（CatSpider 的 tabs）再加载内容。 */
  const setupPlugin = async (): Promise<void> => {
    const entry = currentEntry.value
    abort?.abort()
    videos.value = []
    page.value = 1
    pageCount.value = 0
    total.value = 0
    error.value = ''
    moreError.value = ''
    categories.value = []
    if (!entry) return
    loading.value = true
    const tabs = await getConfig(entry.name)
      .then(r => (r.success && r.data ? parsePluginTabs(r.data) : []))
      .catch(() => [] as BrowseCategory[])
    loading.value = false
    if (!tabs.length) {
      error.value = `${entry.name} 暂不支持分类浏览`
      return
    }
    categories.value = tabs
    categoryCache.value[entry.api] = tabs
    categoryId.value = tabs[0].id
    categoryName.value = tabs[0].name
    sort.value = 'latest'
    await load()
  }

  /** 按当前数据源的类型准备分类并加载。 */
  const enterSource = async (): Promise<void> => {
    if (isPlugin.value) await setupPlugin()
    else {
      restoreVisit()
      await load()
    }
  }

  const selectCategory = (category: BrowseCategory): void => {
    if (categoryName.value === category.name) return
    categoryId.value = category.id
    categoryName.value = category.name
    page.value = 1
    saveVisit()
    void load()
  }

  const onFilterChange = (value: Record<string, string>): void => {
    if (value.source && value.source !== sourceApi.value)
      sourceApi.value = value.source
    if (value.sort && value.sort !== sort.value)
      sort.value = value.sort as BrowseSort
    if (value.category && value.category !== categoryName.value) {
      const category = categories.value.find(
        item => item.name === value.category
      )
      if (category) selectCategory(category)
    }
  }

  /** 已选数据源不在清单里时退回第一个。 */
  const reconcileSource = (): void => {
    if (options.entries.value.some(entry => entry.api === sourceApi.value))
      return
    sourceApi.value = options.entries.value[0]?.api ?? ''
  }

  watch(
    options.entries,
    () => {
      if (options.ready.value) reconcileSource()
    },
    { immediate: true }
  )
  watch(sourceApi, () => void enterSource())
  watch(sort, () => {
    saveVisit()
    void load()
  })

  /** 页面挂载：数据源未变化时由这里加载（变化了交给 watcher）。 */
  const init = async (): Promise<void> => {
    const before = sourceApi.value
    reconcileSource()
    if (sourceApi.value === before) await enterSource()
  }

  return {
    scrollEl,
    videos,
    sortedVideos,
    total,
    loading,
    error,
    loadingMore,
    moreError,
    hasMore,
    currentEntry,
    categoryName,
    filterRows,
    filterModel,
    onFilterChange,
    onScroll,
    load,
    init,
    dispose: () => abort?.abort(),
  }
}
