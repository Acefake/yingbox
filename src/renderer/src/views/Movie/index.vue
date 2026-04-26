<template>
  <div class="folder-content relative h-full text-white overflow-hidden">
    <!-- 左侧悬浮面板 -->
    <div class="absolute left-4 top-4 bottom-4 z-20 flex flex-col">
      <LeftPanel
        :processed-items="processedItems"
        :selected-index="selectedIndex"
        :dir-loading="dirLoading"
        :scan-progress="scanProgress"
        :is-multi-select-mode="isMultiSelectMode"
        :selected-items="selectedItems"
        :selected-items-count="selectedItems.size"
        :directory-paths="currentDirectoryPath ? [currentDirectoryPath] : []"
        @refresh="refreshFiles"
        @remove-directory="clearCacheAndData"
        @add-folder="handleReadDirectory"
        @clear-cache="handleShowClearCacheDialog"
        @select-item="selectItem"
        @show-search-modal="handleAutoScrape"
        @manual-scrape="handleManualScrape"
        @auto-scrape="handleAutoScrape"
        @direct-scrape="handleDirectScrape"
        @toggle-multi-select="toggleMultiSelectMode"
        @toggle-select-all="toggleSelectAll"
        @add-selected-to-queue="addSelectedToScrapeQueue"
        @toggle-selection="toggleItemSelection"
        @local-scrape="handleLocalScrape"
        @download-video="handleDownloadVideo"
        @fetch-meta="handleFetchMeta"
      />
    </div>

    <!-- 右侧内容区域 -->
    <div
      class="absolute inset-0 z-10"
      :style="{ paddingLeft: leftPanelWidth + 32 + 'px' }"
    >
      <EmptyPlaceholder v-if="!selectedItem" />

      <div v-else class="p-6 h-full overflow-y-auto">
        <RightPanel
          :selected-item="selectedItem"
          :poster-image-data-url="posterImageDataUrl"
          :movie-info="movieInfo"
          :fanart-image-data-url="fanartImageDataUrl"
          :actors="actors"
        />
      </div>
    </div>

    <!-- 搜索结果弹窗 -->
    <MediaSearchModal
      :visible="showSearchModal"
      :results="searchMovies"
      type="movie"
      :initial-query="currentScrapeItem?.name"
      @close="handleCloseSearchModal"
      @scrape="handleScrapeMovie"
      @research="handleResearch"
    />

    <!-- 手动匹配弹窗 -->
    <ManualScrapeModal
      v-model:visible="showManualScrapeModal"
      :current-item="currentScrapeItem"
      @search="handleManualSearch"
      @cancel="handleCancelManualScrape"
    />

    <!-- 元数据预览弹窗 -->
    <MetaPreviewModal
      :visible="showMetaPreviewModal"
      :avid="metaPreviewAvid"
      @close="showMetaPreviewModal = false"
    />

    <!-- JavBus 刮削弹窗 -->
    <JavBusScrapeModal
      ref="javBusScrapeModal"
      :visible="showJavBusScrapeModal"
      :avid="javBusScrapeAvid"
      :item="javBusScrapeItem"
      @close="showJavBusScrapeModal = false"
      @scrape="handleJavBusScrape"
      @add-to-queue="handleJavBusAddToQueue"
    />

    <!-- 下载弹窗 -->
    <DownloadModal
      :visible="showDownloadModal"
      :avid="downloadAvid"
      :sites="downloaderSites"
      @cancel="showDownloadModal = false"
      @done="handleDownloadDone"
    />

    <!-- 本地刮削状态提示 -->
    <Transition name="toast-fade">
      <div
        v-if="localScrapeToast"
        class="fixed bottom-8 left-1/2 -translate-x-1/2 z-[999] px-4 py-2 rounded-lg text-sm text-white"
        style="background: rgba(20,20,28,0.95); border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(12px);"
      >{{ localScrapeToast }}</div>
    </Transition>

  </div>
</template>

<script setup lang="ts">
import { inject, onMounted, ref, watch, onUnmounted } from 'vue'
import EmptyPlaceholder from '@/components/EmptyPlaceholder.vue'
import { backend } from '@/api/backend'
import { Modal } from 'ant-design-vue'
import { ProcessedItem } from '@/types'
import RightPanel from '@/views/movie/RightPanel.vue'
import LeftPanel from '@/views/movie/components/LeftPanel.vue'
import MediaSearchModal from '@/components/MediaSearchModal.vue'
import type { MediaResult } from '@/components/MediaSearchModal.vue'
import ManualScrapeModal from '@/views/movie/components/ManualScrapeModal.vue'
import DownloadModal from '@/views/movie/components/DownloadModal.vue'
import MetaPreviewModal from '@/views/movie/components/MetaPreviewModal.vue'
import JavBusScrapeModal from '@/views/movie/components/JavBusScrapeModal.vue'
import { getScrapeProviderConfig } from '@/stores/scrape-provider-store'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import { useScraping } from '@/views/movie/composables/use-scraping'
import { useFileManagement } from '@/views/movie/composables/use-file-management'
import { useScrapingQueue } from '@/views/movie/composables/use-scraping-queue'
import { useMediaProcessing, bumpScrapeVersion } from '@/views/movie/composables/use-media-processing'
import { useScrapingTask } from '@/views/movie/composables/use-scraping-task'

interface AppLayoutMethods {
  setGlobalBackground: (imageUrl: string, overlayColor: string) => void
  clearGlobalBackground: () => void
}

const appLayoutMethods = inject('appLayoutMethods') as
  | AppLayoutMethods
  | undefined

const { searchMovieInfo } = useScraping()

// 弹窗状态管理
const showSearchModal = ref(false)
const searchMovies = ref<MediaResult[]>([])
const showManualScrapeModal = ref(false)
const currentScrapeItem = ref<ProcessedItem | null>(null)

// 下载弹窗状态
const showDownloadModal = ref(false)
const downloadAvid = ref('')

// 元数据预览弹窗状态
const showMetaPreviewModal = ref(false)
const metaPreviewAvid = ref('')

// JavBus 刮削弹窗状态
const showJavBusScrapeModal = ref(false)
const javBusScrapeAvid = ref('')
const javBusScrapeItem = ref<ProcessedItem | null>(null)
const javBusScrapeModal = ref<InstanceType<typeof JavBusScrapeModal> | null>(null)
const localScrapeToast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const downloaderSites = [
  { downloaderName: 'MissAV', domain: 'missav.ai', weight: 1000 },
  { downloaderName: 'Jable', domain: 'jable.tv', weight: 1500 },
  { downloaderName: 'HohoJ', domain: 'hohoj.tv', weight: 400 },
  { downloaderName: 'Memo', domain: 'memojav.com', weight: 600 },
  { downloaderName: 'KanAV', domain: 'kanav.info', weight: 490 },
]

// 左侧边栏状态
const selectedIndex = ref(-1)
const leftPanelWidth = ref(280)
const isMultiSelectMode = ref(false)
const selectedItems = ref<Set<string>>(new Set())
const selectedItemsData = ref<ProcessedItem[]>([])

// 文件管理相关状态和方法
const {
  fileData,
  currentDirectoryPath,
  dirLoading,
  scanProgress,
  processFiles,
  readDirectory,
  refreshFiles,
  refreshAfterScrape,
  loadFromCache,
  clearCacheAndData,
} = useFileManagement()

// 刮削队列相关状态和方法
const {
  scrapeQueue,
  isProcessingQueue,
  currentQueueIndex,
  addToQueue,
} = useScrapingQueue()

// 基础状态
const selectedItem = ref<ProcessedItem | null>(null)

// 媒体处理相关状态
const { posterImageDataUrl, fanartImageDataUrl, movieInfo, actors, warmNfoCache } =
  useMediaProcessing(selectedItem)

// 计算属性改为 ref，支持直接修改
const processedItems = ref<ProcessedItem[]>([])

// 初始化 processedItems
const updateProcessedItems = (): void => {
  processedItems.value = processFiles(fileData.value)
}

// fileData 变化时自动同步（覆盖所有刷新路径，包括队列处理器）
watch(fileData, () => {
  updateProcessedItems()
  // 刷新后把 selectedItem 指向新扫描对象，使 fanartImagePath 能读到最新 files
  if (selectedItem.value) {
    const refreshed = processedItems.value.find(i => i.path === selectedItem.value!.path)
    if (refreshed) selectedItem.value = refreshed
  }
}, { deep: true })

// 包装 readDirectory，读取后更新 processedItems
const handleReadDirectory = async (): Promise<void> => {
  await readDirectory()
  updateProcessedItems()
  warmNfoCache(processedItems.value)
}

// 弹窗管理方法 - 直接写在组件内部，逻辑简单清晰
const handleShowSearchModal = (movies: MediaResult[], item?: ProcessedItem): void => {
  searchMovies.value = movies
  if (item) {
    currentScrapeItem.value = item
  }
  showSearchModal.value = true
}

const handleCloseSearchModal = (): void => {
  showSearchModal.value = false
  searchMovies.value = []
}

/** 用户手动修改搜索关键词重新搜索 */
const handleResearch = async (query: string): Promise<void> => {
  const item = currentScrapeItem.value
  if (!item) return
  try {
    const movies = await searchMovieInfo({ ...item, name: query })
    searchMovies.value = movies
  } catch (error) {
    console.error('重新搜索电影失败:', error)
  }
}

const handleShowManualScrapeModal = (item: ProcessedItem): void => {
  currentScrapeItem.value = item
  showManualScrapeModal.value = true
}

const handleCloseManualScrapeModal = (): void => {
  showManualScrapeModal.value = false
}

// 刮削项目状态管理 - 简单的状态操作直接写在组件里
const clearCurrentScrapeItem = (): void => {
  currentScrapeItem.value = null
}

const setCurrentScrapeItem = (item: ProcessedItem | null): void => {
  currentScrapeItem.value = item
}

// 左侧边栏管理方法 - 这些逻辑都是组件特有的，直接写在组件里更清晰
const selectItem = (item: ProcessedItem, index: number): void => {
  if (isMultiSelectMode.value) {
    // 多选模式
    toggleItemSelection(item)
  } else {
    // 单选模式 - 如果点击已选中的项目，则取消选择
    if (selectedItem.value?.path === item.path) {
      selectedItem.value = null
      selectedIndex.value = -1
    } else {
      selectedItem.value = item
      selectedIndex.value = index
    }
  }
}

const toggleItemSelection = (item: ProcessedItem): void => {
  if (selectedItems.value.has(item.path)) {
    selectedItems.value.delete(item.path)
  } else {
    selectedItems.value.add(item.path)
  }
  updateSelectedItemsData()
}

const updateSelectedItemsData = (): void => {
  const pathSet = selectedItems.value
  selectedItemsData.value = processedItems.value.filter(item => pathSet.has(item.path))
}

const toggleMultiSelectMode = (): void => {
  isMultiSelectMode.value = !isMultiSelectMode.value
  if (!isMultiSelectMode.value) {
    // 退出多选模式时清空选择
    selectedItems.value.clear()
    selectedItemsData.value = []
  }
}

const toggleSelectAll = (): void => {
  if (selectedItems.value.size === processedItems.value.length) {
    // 当前全选，执行取消全选
    selectedItems.value.clear()
  } else {
    // 执行全选
    selectedItems.value.clear()
    processedItems.value.forEach(item => {
      selectedItems.value.add(item.path)
    })
  }
  updateSelectedItemsData()
}

/**
 * 批量添加选中项目到刮削队列 - 这个复杂的业务逻辑直接写在组件里，逻辑清晰
 */
const addSelectedToScrapeQueue = async (): Promise<void> => {
  if (selectedItemsData.value.length === 0) {
    return
  }

  let successCount = 0
  let failedCount = 0

  try {
    // 为每个选中的项目搜索电影信息
    for (let i = 0; i < selectedItemsData.value.length; i++) {
      const item = selectedItemsData.value[i]

      // 从文件名提取电影名称
      const movieName = item.name
        .replace(/\.[^/.]+$/, '') // 去除扩展名
        .replace(/[[](){}]/g, '') // 去除括号
        .trim()

      // 搜索电影信息
      const searchedMovie = await searchMovieInfo(item)

      let movieToAdd: Movie

      if (searchedMovie && searchedMovie.length > 0) {
        // 如果搜索到了电影，使用第一个搜索结果
        movieToAdd = searchedMovie[0]
        successCount++
      } else {
        // 如果没有搜索到，创建默认电影信息
        movieToAdd = {
          id: Date.now() + Math.random(), // 临时ID
          title: movieName || item.name,
          overview: `未找到匹配的电影：${movieName || item.name}`,
          release_date: '',
          poster_path: '',
          backdrop_path: '',
          vote_average: 0,
          vote_count: 0,
          genre_ids: [],
          adult: false,
          original_language: 'zh',
          original_title: movieName || item.name,
          popularity: 0,
          video: false,
        }
        failedCount++
      }

      // 添加到队列
      addToQueue(item, movieToAdd)

      // 添加短暂延迟，避免API请求过快
      await new Promise(resolve => setTimeout(resolve, 300))
    }

    // 清空选择
    selectedItems.value.clear()
    selectedItemsData.value = []
  } catch (error) {
    console.error('批量添加失败:', error)
  }
}

/**
 * 显示清除缓存确认对话框 - 弹窗逻辑直接写在组件里
 */
const handleShowClearCacheDialog = (): void => {
  Modal.confirm({
    title: '确认清除缓存',
    content: '此操作将清除所有缓存数据，包括文件列表和路径信息。确定要继续吗？',
    okText: '确认清除',
    cancelText: '取消',
    okType: 'danger',
    onOk() {
      clearCacheAndData()
    },
  })
}

/**
 * 处理手动匹配事件 - 事件处理逻辑直接写在组件里
 * @param item 要匹配的项目
 */
const handleManualScrape = (item: ProcessedItem): void => {
  handleShowManualScrapeModal(item)
}

/**
 * 处理手动搜索事件 - 用用户输入的关键词走 provider 搜索逻辑
 */
const handleManualSearch = async (query: string): Promise<void> => {
  const item = currentScrapeItem.value
  if (!item) return
  try {
    const movies = await searchMovieInfo({ ...item, name: query })
    if (movies && movies.length > 0) {
      searchMovies.value = movies
      showSearchModal.value = true
    } else {
      showManualScrapeModal.value = true
    }
  } catch (error) {
    console.error('手动搜索失败:', error)
    showManualScrapeModal.value = true
  }
}

/**
 * 取消手动匹配 - 简单的状态操作直接写在组件里
 */
const handleCancelManualScrape = (): void => {
  handleCloseManualScrapeModal()
}

/**
 * 添加刮削任务到队列 - 队列管理逻辑直接写在组件里
 * @param movie 电影数据
 */
const addToScrapeQueue = async (movie: Movie): Promise<void> => {
  if (!currentScrapeItem.value) {
    return
  }

  // 添加到队列
  addToQueue(currentScrapeItem.value, movie)

  // 关闭搜索模态框
  handleCloseSearchModal()

  // 立即开始处理（currentScrapeItem 保持有效，处理完再清空）
  await startProcessingQueue()
}

/**
 * 开始处理刮削队列 - 队列处理逻辑直接写在组件里，逻辑清晰
 */
const startProcessingQueue = async (): Promise<void> => {
  if (scrapeQueue.value.length === 0) {
    return
  }

  if (isProcessingQueue.value) {
    return
  }

  try {
    isProcessingQueue.value = true
    currentQueueIndex.value = 0

    // 逐个处理队列中的任务
    await processNextQueueItem()
  } catch (error) {
    console.error('处理队列失败:', error)
  } finally {
    isProcessingQueue.value = false
    clearCurrentScrapeItem()
  }
}

/**
 * 处理队列中的下一个项目 - 队列处理的核心逻辑直接写在组件里，逻辑清晰
 */
const processNextQueueItem = async (): Promise<void> => {
  // 检查是否还有待处理的任务
  if (currentQueueIndex.value >= scrapeQueue.value.length) {
    // 清空队列
    scrapeQueue.value = []
    currentQueueIndex.value = 0
    isProcessingQueue.value = false
    clearCurrentScrapeItem()

    // 队列处理完成，无需额外全量刷新（每个任务完成时已定向刷新）
    return
  }

  // 检查处理是否被停止
  if (!isProcessingQueue.value) {
    return
  }

  const task = scrapeQueue.value[currentQueueIndex.value]

  try {
    // 设置当前刮削项目
    setCurrentScrapeItem(task.item)

    // 执行刮削（refreshSpecificDirectory 已在 processSingleScrapeTask 内部调用）
    await processSingleScrapeTask(task.movie)

    // 移动到下一个任务
    currentQueueIndex.value++

    // 短暂延迟，避免过快处理
    await new Promise(resolve => setTimeout(resolve, 500))

    // 递归处理下一个任务
    await processNextQueueItem()
  } catch (error) {
    console.error(`处理 ${task.movie.title} 失败:`, error)

    // 即使当前任务失败，也继续处理下一个
    currentQueueIndex.value++
    await processNextQueueItem()
  }
}

/**
 * 处理电影刮削：添加到队列或立即处理 - 刮削处理逻辑直接写在组件里
 * @param movie 电影数据
 */
const handleScrapeMovie = async (movie: MediaResult): Promise<void> => {
  addToScrapeQueue(movie as unknown as Movie)
}

/**
 * 处理自动刮削 - 自动刮削逻辑直接写在组件里，逻辑清晰
 * @param item 要刮削的项目
 */
const handleAutoScrape = async (item: ProcessedItem): Promise<void> => {
  const provider = getScrapeProviderConfig().provider

  // JavBus：使用独立刮削预览弹窗
  if (provider === 'javbus') {
    const avid = item.name
      .replace(/\.[^/.]+$/, '')
      .replace(/\s*\(\d{4}\)\s*$/, '')
      .trim()
      .toUpperCase()
    javBusScrapeAvid.value = avid
    javBusScrapeItem.value = item
    showJavBusScrapeModal.value = true
    return
  }

  try {
    const movies = await searchMovieInfo(item)

    if (movies && movies.length > 0) {
      handleShowSearchModal(movies, item)
    } else {
      handleShowManualScrapeModal(item)
    }
  } catch (error) {
    console.error('自动刮削失败:', error)
    handleShowManualScrapeModal(item)
  }
}

/**
 * JavBus 直接刮削 - 从预览弹窗触发
 */
const handleJavBusScrape = async (meta: any, item: ProcessedItem): Promise<void> => {
  currentScrapeItem.value = item
  const movie: Movie = {
    id: meta.avid as any,
    title: meta.title || meta.avid,
    original_title: meta.avid,
    overview: meta.description || '',
    release_date: meta.release_date || '',
    vote_average: 0,
    vote_count: 0,
    poster_path: meta.cover || '',
    backdrop_path: meta.fanarts?.[0] || '',
    adult: false,
    genre_ids: [],
    original_language: 'ja',
    popularity: 0,
    video: false,
    _javbus: meta,
  } as any as Movie

  try {
    await processSingleScrapeTask(movie)
    javBusScrapeModal.value?.setResult(`✅ 刮削完成`)
  } catch (e) {
    javBusScrapeModal.value?.setScrapeError(`刮削失败: ${e instanceof Error ? e.message : '未知错误'}`)
  }
}

/**
 * JavBus 加入队列 - 从预览弹窗触发
 */
const handleJavBusAddToQueue = async (movie: Movie, item: ProcessedItem): Promise<void> => {
  currentScrapeItem.value = item
  addToQueue(item, movie)
  handleCloseSearchModal()

  // 立即开始处理队列
  if (!isProcessingQueue.value) {
    try {
      isProcessingQueue.value = true
      currentQueueIndex.value = 0
      await processNextQueueItem()
    } finally {
      isProcessingQueue.value = false
      clearCurrentScrapeItem()
    }
  }

  javBusScrapeModal.value?.setResult('✅ 刮削完成', false)
}

/**
 * 处理直接刮削 - 不加入队列，直接刮削
 * @param item 要刮削的项目
 */
const handleDirectScrape = async (item: ProcessedItem): Promise<void> => {
  try {
    // 设置当前刮削项目
    currentScrapeItem.value = item

    // 调用useScraping中的searchMovieInfo函数
    const movies = await searchMovieInfo(item)

    if (movies && movies.length > 0) {
      // 如果只有一个匹配结果，直接刮削
      if (movies.length === 1) {
        // 直接调用刮削任务
        const { processSingleScrapeTask: processTask } = useScrapingTask()
        const folderPath = await processTask(movies[0], item)

        // 刮削完成，重新扫描父目录更新 UI
        if (folderPath) {
          bumpScrapeVersion()
          await refreshAfterScrape(folderPath)
        }
      } else {
        handleShowSearchModal(movies, item)
      }
    }
  } catch (error) {
    console.error('直接刮削失败:', error)
  }
}

// 处理单个刮削任务 - 刮削任务处理逻辑直接写在组件里，逻辑清晰
const processSingleScrapeTask = async (movie: Movie): Promise<string | null> => {
  if (!currentScrapeItem.value) {
    return null
  }

  try {
    // 使用useScrapingTask中的方法
    const { processSingleScrapeTask: processTask } = useScrapingTask()
    const folderPath = await processTask(movie, currentScrapeItem.value!)

    // 刮削完成，重新扫描父目录更新 UI
    if (folderPath) {
      bumpScrapeVersion()
      await refreshAfterScrape(folderPath)
    }
    return folderPath
  } catch (error) {
    console.error('处理失败:', error)
    return null
  }
}

/**
 * 监听背景图变化，控制全局背景
 */
watch(
  [selectedItem, fanartImageDataUrl],
  ([newSelectedItem, newFanartImageDataUrl]) => {
    if (appLayoutMethods) {
      if (newSelectedItem && newFanartImageDataUrl) {
        // 设置全局背景艺术图
        appLayoutMethods.setGlobalBackground(
          newFanartImageDataUrl,
          'rgba(17, 24, 39, 0.2)'
        )
      } else {
        // 清除全局背景
        appLayoutMethods.clearGlobalBackground()
      }
    }
  },
  { immediate: true }
)

// 本地刮削
const handleLocalScrape = async (item: ProcessedItem): Promise<void> => {
  const avid = item.name
    .replace(/\.[^/.]+$/, '')      // 去扩展名
    .replace(/\s*\(\d{4}\)\s*$/, '') // 去年份后缀 (2020)
    .trim()
    .toUpperCase()
  showToast(`正在刮削 ${avid}...`)
  try {
    const meta = await backend.scrape(avid)
    if (meta.error) {
      showToast(`刮削失败: ${meta.error}`)
      console.error(`[scrape:${avid}] error:`, meta.error)
      return
    }
    showToast(`刮削完成: ${meta.title || avid}`)
    bumpScrapeVersion()
    await refreshAfterScrape(item.type === 'folder' ? item.path : item.path.replace(/[\\/][^\\/]+$/, ''))
  } catch (e) {
    console.error('[scrape] exception:', e)
    showToast('刮削异常，请检查 Go 后端日志')
  }
}

// 下载视频
const handleDownloadVideo = (item: ProcessedItem): void => {
  const avid = item.name
    .replace(/\.[^/.]+$/, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim()
    .toUpperCase()
  downloadAvid.value = avid
  showDownloadModal.value = true
}

const handleFetchMeta = (item: ProcessedItem): void => {
  const avid = item.name
    .replace(/\.[^/.]+$/, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim()
    .toUpperCase()
  metaPreviewAvid.value = avid
  showMetaPreviewModal.value = true
}

const handleDownloadDone = (_avid: string, msg: string): void => {
  showToast(msg || '已提交下载任务')
}

const showToast = (msg: string): void => {
  localScrapeToast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { localScrapeToast.value = '' }, 3000)
}

onUnmounted(() => { if (toastTimer) clearTimeout(toastTimer) })

onMounted(() => {
  const loaded = loadFromCache()

  if (loaded) {
    // 组件启动时已从缓存加载数据，初始化 processedItems
    updateProcessedItems()
  }
})
</script>

<style scoped>
.folder-item {
  transition: all 0.2s ease-in-out;
}

.folder-item:hover {
  transform: translateY(-2px);
}

.empty-state {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

.glass-panel {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
  transition: background-color 0.3s ease;
}

.glass-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: inherit;
  backdrop-filter: inherit;
  -webkit-backdrop-filter: inherit;
  z-index: -1;
}

.selected-item {
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 4px 16px 0 rgba(0, 0, 1, 0.2);
  transition: all 0.3s ease;
}

/* 海报3D悬浮效果 */
.poster-3d {
  perspective: 1000px;
  transform-style: preserve-3d;
  transition: all 0.3s ease;
}

.poster-3d:hover {
  transform: rotateY(-5deg) rotateX(5deg) translateZ(20px);
  box-shadow:
    0 20px 40px rgba(0, 0, 0, 0.3),
    0 10px 20px rgba(0, 0, 0, 0.2),
    -10px 0 20px rgba(0, 0, 0, 0.1);
}

.poster-3d:hover img {
  transform: scale(1.05);
}

/* 悬浮面板样式 */
.glass-panel-floating {
  background: rgba(17, 24, 39, 0.3);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.05);
  transition: all 0.3s ease;
}

.glass-panel-floating:hover {
  background: rgba(17, 24, 39, 0.4);
  border-color: rgba(255, 255, 255, 0.2);
  box-shadow:
    0 32px 64px -12px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 255, 255, 0.1);
}
</style>
