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
        @add-selected-to-queue="batchScrapeSelected"
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
      @scrape="handlePickMovie"
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
  </div>
</template>

<script setup lang="ts">
import { inject, onMounted, ref, watch } from 'vue'
import EmptyPlaceholder from '@/components/EmptyPlaceholder.vue'
import { backend } from '@/api/backend'
import { Modal, message } from 'ant-design-vue'
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
import {
  useMediaProcessing,
  bumpScrapeVersion,
} from '@/views/movie/composables/use-media-processing'
import { useScrapingTask } from '@/views/movie/composables/use-scraping-task'

interface AppLayoutMethods {
  setGlobalBackground: (imageUrl: string, overlayColor: string) => void
  clearGlobalBackground: () => void
}

const appLayoutMethods = inject('appLayoutMethods') as
  | AppLayoutMethods
  | undefined

const { searchMovieInfo } = useScraping()
const { processSingleScrapeTask: processTask } = useScrapingTask()

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
const javBusScrapeModal = ref<InstanceType<typeof JavBusScrapeModal> | null>(
  null
)

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

// 刮削队列相关状态和方法 - 已简化为直接刮削

// 基础状态
const selectedItem = ref<ProcessedItem | null>(null)

// 媒体处理相关状态
const {
  posterImageDataUrl,
  fanartImageDataUrl,
  movieInfo,
  actors,
  warmNfoCache,
} = useMediaProcessing(selectedItem)

// 计算属性改为 ref，支持直接修改
const processedItems = ref<ProcessedItem[]>([])

// 初始化 processedItems
const updateProcessedItems = (): void => {
  processedItems.value = processFiles(fileData.value)
}

// fileData 变化时自动同步（覆盖所有刷新路径，包括队列处理器）
watch(
  fileData,
  () => {
    updateProcessedItems()
    // 刷新后把 selectedItem 指向新扫描对象，使 fanartImagePath 能读到最新 files
    if (selectedItem.value) {
      const refreshed = processedItems.value.find(
        i => i.path === selectedItem.value!.path
      )
      if (refreshed) selectedItem.value = refreshed
    }
  },
  { deep: true }
)

// 包装 readDirectory，读取后更新 processedItems
const handleReadDirectory = async (): Promise<void> => {
  await readDirectory()
  updateProcessedItems()
  warmNfoCache(processedItems.value)
}

// 弹窗管理方法 - 直接写在组件内部，逻辑简单清晰
const handleShowSearchModal = (
  movies: MediaResult[],
  item?: ProcessedItem
): void => {
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
  selectedItemsData.value = processedItems.value.filter(item =>
    pathSet.has(item.path)
  )
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
 * 批量直接刮削选中项目
 */
const batchScrapeSelected = async (): Promise<void> => {
  if (selectedItemsData.value.length === 0) {
    return
  }

  let successCount = 0
  message.loading(`正在批量处理 ${selectedItemsData.value.length} 个项目...`, 0)

  try {
    for (const item of selectedItemsData.value) {
      currentScrapeItem.value = item
      const movies = await searchMovieInfo(item)
      if (movies && movies.length > 0) {
        await processTask(movies[0], item)
        successCount++
      }
    }
    message.destroy()
    message.success(`批量处理完成，共成功刮削 ${successCount} 个项目`)
    
    // 清空选择
    selectedItems.value.clear()
    selectedItemsData.value = []
  } catch (error) {
    message.destroy()
    console.error('批量处理失败:', error)
    message.error('批量处理过程中出现错误')
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
 * 刮削此结果并关闭模态框
 */
const handlePickMovie = async (movie: Movie): Promise<void> => {
  showSearchModal.value = false
  await processSingleScrapeTask(movie)
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
const handleJavBusScrape = async (
  meta: any,
  item: ProcessedItem
): Promise<void> => {
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
    javBusScrapeModal.value?.setScrapeError(
      `刮削失败: ${e instanceof Error ? e.message : '未知错误'}`
    )
  }
}

/**
 * JavBus 加入队列 - 已简化为直接刮削
 */
const handleJavBusAddToQueue = async (
  movie: Movie,
  item: ProcessedItem
): Promise<void> => {
  currentScrapeItem.value = item
  await handleJavBusScrape(movie, item)
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
const processSingleScrapeTask = async (
  movie: Movie
): Promise<string | null> => {
  if (!currentScrapeItem.value) {
    return null
  }

  try {
    // 使用useScrapingTask中的方法
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
    .replace(/\.[^/.]+$/, '') // 去扩展名
    .replace(/\s*\(\d{4}\)\s*$/, '') // 去年份后缀 (2020)
    .trim()
    .toUpperCase()
  message.loading(`正在刮削 ${avid}...`, 0)
  try {
    const meta = await backend.scrape(avid)
    message.destroy()
    if (meta.error) {
      message.error(`刮削失败: ${meta.error}`)
      console.error(`[scrape:${avid}] error:`, meta.error)
      return
    }
    message.success(`刮削完成: ${meta.title || avid}`)
    bumpScrapeVersion()
    await refreshAfterScrape(
      item.type === 'folder'
        ? item.path
        : item.path.replace(/[\\/][^\\/]+$/, '')
    )
  } catch (e) {
    message.destroy()
    console.error('[scrape] exception:', e)
    message.error('刮削异常，请检查 Go 后端日志')
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
  message.success(msg || '已提交下载任务')
}

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
  transition: var(--transition-fast);
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

.selected-item {
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 4px 16px 0 rgba(0, 0, 1, 0.2);
  transition: var(--transition-normal);
}
</style>
