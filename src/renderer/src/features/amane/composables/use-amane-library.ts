/**
 * Amane 片库页的列表状态：视图切换、搜索 / 筛选 / 排序、分页与无限滚动、多选。
 *
 * 请求按 generation 防串台：新请求发出后，旧请求回来直接丢弃。
 * 评分排序后台不支持，拉全量后在前端排，结果按查询条件缓存，翻页不再重复拉。
 */
import { type Ref, ref } from 'vue'
import {
  type AmaneActor,
  type AmaneFile,
  type AmaneFilm,
  type AmaneLibrary,
  type AmaneTask,
  type Page,
  amaneRequest,
} from '../api/amane'
import {
  type AmaneTab,
  type MetadataSortField,
  PAGE_SIZE,
  RESOURCES,
  SCROLL_TABS,
  type SortOrder,
  hasMore,
  listQuery,
  nearBottom,
  nextSort,
  sortByScore,
} from '../utils/library-query'

type Row = AmaneFilm | AmaneActor | AmaneLibrary | AmaneTask | AmaneFile

export interface LibraryHooks {
  /** 是否已连上 Amane（未连接时不发请求） */
  connected: Ref<boolean>
  /** 切换视图 / 滚动列表前收起悬停预览与详情 */
  beforeSwitch: () => void
  /** 悬停预览：列表滚动时收起 */
  hideHover: () => void
  /** 影片列表被整页替换后（不是追加），清理依赖旧列表的缓存 */
  onFilmsReplaced: (films: AmaneFilm[]) => void
}

export function useAmaneLibrary(hooks: LibraryHooks) {
  const tab = ref<AmaneTab>('films'),
    busy = ref(false),
    loading = ref(false),
    loadingMore = ref(false),
    error = ref('')
  const search = ref(''),
    taskStatus = ref(''),
    page = ref(0),
    total = ref(0)
  const actorFilter = ref<number | null>(null),
    tagFilter = ref<number | null>(null),
    libraryFilter = ref<number | null>(null),
    filterLabel = ref('')
  const films = ref<AmaneFilm[]>([]),
    actors = ref<AmaneActor[]>([]),
    libraries = ref<AmaneLibrary[]>([]),
    tasks = ref<AmaneTask[]>([]),
    files = ref<AmaneFile[]>([]),
    selectedIds = ref<number[]>([]),
    workerPaused = ref(false)
  const advancedOpen = ref(false),
    advancedFilters = ref<Record<string, string[]>>({})
  const sortField = ref<MetadataSortField>('updated_at'),
    sortOrder = ref<SortOrder>('desc'),
    sortOpen = ref(false)
  let generation = 0,
    disposed = false,
    scoredFilmsCache: { key: string; items: AmaneFilm[] } | null = null

  /** 串行执行一个操作：忙时忽略，出错写进顶部横幅 */
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      await action()
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      busy.value = false
    }
  }

  /** 评分排序：拉全量（每批 200）→ 前端排序 → 按条件缓存 → 取当前页 */
  async function loadScored(
    query: URLSearchParams,
    append: boolean,
    current: number
  ): Promise<Page<AmaneFilm> | null> {
    const allQuery = new URLSearchParams(query)
    allQuery.delete('offset')
    allQuery.delete('limit')
    const direction = sortOrder.value
    const key = `${allQuery}|${direction}`
    if (!append || scoredFilmsCache?.key !== key) {
      const items: AmaneFilm[] = []
      let count = Infinity
      while (items.length < count) {
        allQuery.set('offset', String(items.length))
        allQuery.set('limit', '200')
        const batch = await amaneRequest<Page<AmaneFilm>>(
          `/metadata?${allQuery}`
        )
        if (disposed || current !== generation) return null
        if (!batch.items.length) break
        items.push(...batch.items)
        count = batch.total
      }
      scoredFilmsCache = { key, items: sortByScore(items, direction) }
    }
    const items = scoredFilmsCache!.items
    return {
      items: items.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE),
      total: items.length,
    }
  }

  /** 读当前视图的一页；silent 不显示整页加载，append 追加到已有列表 */
  async function load(silent = false, append = false): Promise<void> {
    if (!hooks.connected.value || tab.value === 'agent') return
    const current = ++generation,
      currentTab = tab.value
    if (!silent) loading.value = true
    else if (append) loadingMore.value = true
    const query = listQuery({
      tab: currentTab,
      page: page.value,
      search: search.value,
      sortField: sortField.value,
      sortOrder: sortOrder.value,
      advanced: advancedFilters.value,
      actorId: actorFilter.value,
      tagId: tagFilter.value,
      libraryId: libraryFilter.value,
      taskStatus: taskStatus.value,
    })
    try {
      let result: Page<Row> | null
      if (currentTab === 'films' && sortField.value === 'score') {
        result = await loadScored(query, append, current)
        if (!result) return
      } else {
        scoredFilmsCache = null
        result = await amaneRequest<Page<Row>>(
          `/${RESOURCES[currentTab]}?${query}`
        )
      }
      if (disposed || current !== generation) return
      total.value = result.total || 0
      const merge = <T>(existing: T[], items: Row[]): T[] =>
        append ? [...existing, ...(items as T[])] : (items as T[])
      if (currentTab === 'films') {
        films.value = merge(films.value, result.items)
        if (!append) hooks.onFilmsReplaced(films.value)
      }
      if (currentTab === 'actors')
        actors.value = merge(actors.value, result.items)
      if (currentTab === 'libraries')
        libraries.value = result.items as AmaneLibrary[]
      if (currentTab === 'files') files.value = merge(files.value, result.items)
      if (currentTab === 'tasks') {
        tasks.value = result.items as AmaneTask[]
        const worker = await amaneRequest<{ paused: boolean }>('/tasks/worker')
        if (current === generation) workerPaused.value = worker.paused
      }
    } catch (e) {
      if (current === generation) {
        error.value = (e as Error).message
        if (append) page.value = Math.max(0, page.value - 1)
      }
    } finally {
      if (current === generation) {
        loading.value = false
        loadingMore.value = false
      }
    }
  }

  function switchTab(next: AmaneTab): void {
    hooks.beforeSwitch()
    sortOpen.value = false
    tab.value = next
    page.value = 0
    search.value = ''
    selectedIds.value = []
    void load()
  }

  function searchNow(): void {
    page.value = 0
    selectedIds.value = []
    void load()
  }

  function chooseSort(field: MetadataSortField): void {
    const next = nextSort(
      { field: sortField.value, order: sortOrder.value },
      field
    )
    sortField.value = next.field
    sortOrder.value = next.order
    sortOpen.value = false
    searchNow()
  }

  function applyAdvanced(filters: Record<string, string[]>): void {
    advancedFilters.value = filters
    searchNow()
  }

  function changePage(delta: number): void {
    page.value += delta
    void load()
  }

  /** 列表滚动：收起悬停预览，接近底部且还有下一页时追加 */
  function onListScroll(event: Event): void {
    hooks.hideHover()
    const list = event.target as HTMLElement
    if (list.scrollHeight <= 0) return
    if (!SCROLL_TABS.includes(tab.value)) return
    if (loading.value || loadingMore.value || !hooks.connected.value) return
    if (!hasMore(page.value, total.value)) return
    if (nearBottom(list)) {
      page.value += 1
      void load(true, true)
    }
  }

  function toggleSelect(id: number): void {
    hooks.hideHover()
    const index = selectedIds.value.indexOf(id)
    if (index >= 0) selectedIds.value.splice(index, 1)
    else selectedIds.value.push(id)
  }

  /** 按演员筛影片（从详情或演员页进入） */
  function filterActor(actor: { id: number; name: string }): void {
    if (!actor.id) return
    actorFilter.value = actor.id
    tagFilter.value = null
    filterLabel.value = actor.name
    switchTab('films')
  }

  /** 按标签筛影片 */
  function filterTag(name: string, id: number): void {
    if (!id) return
    tagFilter.value = id
    actorFilter.value = null
    filterLabel.value = name
    switchTab('films')
  }

  function clearFilters(): void {
    actorFilter.value = null
    tagFilter.value = null
    filterLabel.value = ''
    searchNow()
  }

  /** 查看某个媒体库的文件 */
  function browseLibrary(library: AmaneLibrary): void {
    libraryFilter.value = library.id
    switchTab('files')
  }

  function dispose(): void {
    disposed = true
    generation++
  }

  return {
    tab,
    busy,
    loading,
    loadingMore,
    error,
    search,
    taskStatus,
    page,
    total,
    actorFilter,
    tagFilter,
    filterLabel,
    films,
    actors,
    libraries,
    tasks,
    files,
    selectedIds,
    workerPaused,
    advancedOpen,
    advancedFilters,
    sortField,
    sortOrder,
    sortOpen,
    run,
    load,
    switchTab,
    searchNow,
    chooseSort,
    applyAdvanced,
    changePage,
    onListScroll,
    toggleSelect,
    filterActor,
    filterTag,
    clearFilters,
    browseLibrary,
    dispose,
  }
}
