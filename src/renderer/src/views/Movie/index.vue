<template>
  <div class="folder-content relative h-full text-white overflow-hidden">
    <!-- 左侧悬浮面板 -->
    <div class="absolute left-4 top-4 bottom-4 z-20 flex flex-col">
      <LeftPanel
        :processed-items="processedItems"
        :selected-index="selectedIndex"
        :left-panel-width="leftPanelWidth"
        :dir-loading="dirLoading"
        :scrape-queue-count="scrapeQueue.length"
        :is-processing-queue="isProcessingQueue"
        :is-multi-select-mode="isMultiSelectMode"
        :selected-items="selectedItems"
        :selected-items-count="selectedItemsData.length"
        @refresh="targetPath => refreshDirectory(targetPath)"
                 @add-folder="readDirectory"
        @clear-cache="handleShowClearCacheDialog"
        @select-item="selectItem"
        @show-search-modal="handleShowSearchModal"
        @manual-scrape="handleManualScrape"
        @auto-scrape="handleAutoScrape"
        @show-queue="handleShowQueueModal"
        @toggle-multi-select="toggleMultiSelectMode"
        @toggle-select-all="toggleSelectAll"
        @add-selected-to-queue="addSelectedToScrapeQueue"
        @toggle-selection="toggleItemSelection"
      />
    </div>

    <!-- 右侧内容区域 -->
    <div
      class="absolute inset-0 z-10"
      :style="{ paddingLeft: leftPanelWidth + 32 + 'px' }"
    >
      <div
        v-if="!selectedItem"
        class="flex items-center justify-center h-full text-gray-300"
      >
        <div class="flex flex-col items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="2"
            stroke="currentColor"
            class="size-20"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          </svg>
          <p class="text-2xl mb-2">欢迎使用本项目</p>
          <p class="text-sm">请先添加文件夹，点击[+添加]按钮添加文件夹</p>
        </div>
      </div>

      <div v-else class="p-6 h-full overflow-y-auto">
        <RightPanel
          :selected-item="selectedItem"
          :poster-image-data-url="posterImageDataUrl"
          :movie-info="movieInfo"
          :fanart-image-data-url="fanartImageDataUrl"
        />
      </div>
    </div>

    <!-- 搜索结果弹窗 -->
    <SearchResultModal
      :visible="showSearchModal"
      :movies="searchMovies"
      @close="handleCloseSearchModal"
      @scrape="handleScrapeMovie"
    />

    <!-- 手动匹配弹窗 -->
    <ManualScrapeModal
      v-model:visible="showManualScrapeModal"
      :current-item="currentScrapeItem"
      @search-results="handleManualSearch"
      @close="handleCancelManualScrape"
    />

    <!-- 刮削队列管理模态框 -->
    <QueueManagementModal
      v-model:visible="showQueueModal"
      v-model:queue="scrapeQueue"
      v-model:is-processing="isProcessingQueue"
      v-model:current-index="currentQueueIndex"
      @start-processing="startProcessingQueue"
      @stop-processing="stopProcessingQueue"
      @clear-queue="clearScrapeQueue"
      @rematch="rematchMovie"
      @close="handleQueueModalClose"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue'
import { Modal, message } from 'ant-design-vue'
import { ProcessedItem } from '../../types'
import RightPanel from './RightPanel.vue'
import LeftPanel from '../../components/LeftPanel.vue'
import SearchResultModal from '../../components/SearchResultModal.vue'
import ManualScrapeModal from '../../components/ManualScrapeModal.vue'
import QueueManagementModal from '../../components/QueueManagementModal.vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'
import { useScraping } from '../../hooks/useScraping'
import { useFileManagement } from '../../hooks/useFileManagement'
import { useScrapingQueue } from '../../hooks/useScrapingQueue'
import { useMediaProcessing } from '../../hooks/useMediaProcessing'
import { useScrapingTask } from '../../hooks/useScrapingTask'

interface AppLayoutMethods {
  setGlobalBackground: (imageUrl: string, overlayColor: string) => void
  clearGlobalBackground: () => void
}

const appLayoutMethods = inject('appLayoutMethods') as AppLayoutMethods | undefined

const {
  searchMovieInfo,
} = useScraping()

// 弹窗状态管理
const showSearchModal = ref(false)
const searchMovies = ref<Movie[]>([])
const showManualScrapeModal = ref(false)
const currentScrapeItem = ref<ProcessedItem | null>(null)
const showQueueModal = ref(false)

// 左侧边栏状态
const selectedIndex = ref(-1)
const leftPanelWidth = ref(300)
const isMultiSelectMode = ref(false)
const selectedItems = ref<Set<number>>(new Set())
const selectedItemsData = ref<ProcessedItem[]>([])

// 文件管理相关状态和方法
const {
  fileData,
  currentDirectoryPath,
  dirLoading,
  processFiles,
  readDirectory,
  refreshFiles,
  loadFromCache,
  clearCacheAndData,
} = useFileManagement()

// 刮削队列相关状态和方法
const {
  scrapeQueue,
  isProcessingQueue,
  currentQueueIndex,
  addToQueue,
  clearQueue,
  stopProcessing,
  checkQueueStateConsistency,
} = useScrapingQueue()

// 基础状态
const selectedItem = ref<ProcessedItem | null>(null)

// 媒体处理相关状态
const {
  posterImageDataUrl,
  fanartImageDataUrl,
  movieInfo,
} = useMediaProcessing(selectedItem)

// 计算属性
const processedItems = computed((): ProcessedItem[] => {
  return processFiles(fileData.value)
})

// 弹窗管理方法 - 直接写在组件内部，逻辑简单清晰
const handleShowSearchModal = (movies: Movie[], item?: ProcessedItem): void => {
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

const handleShowManualScrapeModal = (item: ProcessedItem): void => {
  currentScrapeItem.value = item
  showManualScrapeModal.value = true
}

const handleCloseManualScrapeModal = (): void => {
  showManualScrapeModal.value = false
}

const handleShowQueueModal = (): void => {
  showQueueModal.value = true
}

const handleCloseQueueModal = (): void => {
  showQueueModal.value = false
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
    toggleItemSelection(item, index)
  } else {
    // 单选模式
    selectedItem.value = item
    selectedIndex.value = index
  }
}

const toggleItemSelection = (_item: ProcessedItem, index: number): void => {
  if (selectedItems.value.has(index)) {
    selectedItems.value.delete(index)
  } else {
    selectedItems.value.add(index)
  }
  updateSelectedItemsData()
}

const updateSelectedItemsData = (): void => {
  const data = Array.from(selectedItems.value)
    .map(index => processedItems.value[index])
    .filter(Boolean)
  selectedItemsData.value = data
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
    processedItems.value.forEach((_, index) => {
      selectedItems.value.add(index)
    })
  }
  updateSelectedItemsData()
}

/**
 * 批量添加选中项目到刮削队列 - 这个复杂的业务逻辑直接写在组件里，逻辑清晰
 */
const addSelectedToScrapeQueue = async (): Promise<void> => {
  if (selectedItemsData.value.length === 0) {
    message.warning('请先选择要添加到队列的项目')
    return
  }

  const loadingMessage = message.loading(
    `正在批量搜索电影信息... (0/${selectedItemsData.value.length})`,
    0
  )

  let successCount = 0
  let failedCount = 0

  try {
    // 为每个选中的项目搜索电影信息
    for (let i = 0; i < selectedItemsData.value.length; i++) {
      const item = selectedItemsData.value[i]

      // 更新加载消息
      loadingMessage()
      message.loading(
        `正在批量搜索电影信息... (${i + 1}/${selectedItemsData.value.length})`,
        0
      )

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

    message.destroy()

    if (successCount > 0 && failedCount > 0) {
      message.success(
        `批量添加完成：成功匹配 ${successCount} 个，未匹配 ${failedCount} 个项目`
      )
    } else if (successCount > 0) {
      message.success(
        `已批量添加 ${successCount} 个项目到刮削队列，全部匹配成功`
      )
    } else {
      message.warning(
        `已添加 ${selectedItemsData.value.length} 个项目到队列，但未找到匹配的电影信息`
      )
    }

    // 清空选择
    selectedItems.value.clear()
    selectedItemsData.value = []
  } catch (error) {
    message.destroy()
    message.error('批量添加失败，请重试')
  }
}

/**
 * 刷新目录 - 文件管理逻辑直接写在组件里，逻辑简单明了
 * @param targetPath 可选的目标路径，如果提供则只刷新该路径，否则刷新当前目录
 */
const refreshDirectory = (targetPath?: string): void => {
  // 检查是否有队列正在处理或有未处理任务
  if (isProcessingQueue.value || scrapeQueue.value.length > 0) {
    message.warning('刮削队列处理中，将在队列完成后自动刷新目录')
    return
  }

  if (targetPath) {
    // 如果提供了目标路径，刷新特定路径
    refreshSpecificPath(targetPath)
  } else {
    // 否则刷新当前目录
    refreshFiles()
  }
}

/**
 * 刷新特定路径 - 路径处理逻辑直接写在组件里
 * @param targetPath 目标路径
 */
const refreshSpecificPath = async (targetPath: string): Promise<void> => {
  try {
    // 检查目标路径是否是当前目录或其子目录
    if (targetPath === currentDirectoryPath.value) {
      // 如果是当前目录，直接刷新整个目录
      refreshFiles()
      return
    }

    // 检查目标路径是否在当前目录下
    if (targetPath.startsWith(currentDirectoryPath.value)) {
      // 如果是子目录，刷新整个当前目录以更新文件列表
      refreshFiles()
      message.success(`已刷新路径: ${targetPath}`)
    } else {
      // 如果不在当前目录下，提示用户
      message.info(`目标路径不在当前目录下: ${targetPath}`)
    }
  } catch (error) {
    message.error('刷新失败')
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
 * 处理手动搜索事件 - 搜索处理逻辑直接写在组件里
 */
const handleManualSearch = async (movies: Movie[]): Promise<void> => {
  if (!movies || movies.length === 0) {
    message.error('没有搜索结果')
    return
  }

  // 关闭手动匹配弹窗
  handleCloseManualScrapeModal()

  // 显示搜索结果弹窗，传递当前项目
  if (currentScrapeItem.value) {
    handleShowSearchModal(movies, currentScrapeItem.value)
    message.success(`找到 ${movies.length} 个匹配结果`)
  } else {
    message.error('当前刮削项目状态异常')
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
const addToScrapeQueue = (movie: Movie): void => {
  if (!currentScrapeItem.value) {
    message.error('没有选中的刮削项目')
    return
  }

  // 添加到队列
  addToQueue(currentScrapeItem.value, movie)

  // 关闭搜索模态框
  handleCloseSearchModal()

  // 清空当前刮削项目
  clearCurrentScrapeItem()
}

/**
 * 开始处理刮削队列 - 队列处理逻辑直接写在组件里，逻辑清晰
 */
const startProcessingQueue = async (): Promise<void> => {
  if (scrapeQueue.value.length === 0) {
    message.info('队列为空')
    return
  }

  if (isProcessingQueue.value) {
    message.info('队列正在处理中')
    return
  }

  try {
    isProcessingQueue.value = true
    currentQueueIndex.value = 0

    message.loading(
      `开始处理刮削队列，共 ${scrapeQueue.value.length} 个任务...`,
      0
    )

    // 逐个处理队列中的任务
    await processNextQueueItem()
  } catch (error) {
    message.destroy()
    message.error(
      `处理队列失败: ${error instanceof Error ? error.message : '未知错误'}`
    )
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
    // 所有任务处理完成
    message.destroy()
    message.success(`队列处理完成！共处理了 ${scrapeQueue.value.length} 个任务`)

    // 清空队列
    scrapeQueue.value = []
    currentQueueIndex.value = 0
    isProcessingQueue.value = false
    clearCurrentScrapeItem()

    // 关闭队列界面
    handleCloseQueueModal()

    // 队列完成后延迟5秒刷新目录
    setTimeout(() => {
      refreshFiles()
    }, 5000) // 延迟5秒执行刷新
    return
  }

  // 检查处理是否被停止
  if (!isProcessingQueue.value) {
    return
  }

  const task = scrapeQueue.value[currentQueueIndex.value]

  try {
    message.destroy()
    message.loading(
      `正在处理 ${task.movie.title} (${currentQueueIndex.value + 1}/${scrapeQueue.value.length})...`,
      0
    )

    // 设置当前刮削项目
    setCurrentScrapeItem(task.item)

    // 执行刮削
    await processSingleScrapeTask(task.movie)

    // 移动到下一个任务
    currentQueueIndex.value++

    // 短暂延迟，避免过快处理
    await new Promise(resolve => setTimeout(resolve, 500))

    // 递归处理下一个任务
    await processNextQueueItem()
  } catch (error) {
    message.destroy()
    message.error(
      `处理 ${task.movie.title} 失败: ${error instanceof Error ? error.message : '未知错误'}`
    )

    // 即使当前任务失败，也继续处理下一个
    currentQueueIndex.value++
    await processNextQueueItem()
  }
}

/**
 * 清空刮削队列 - 队列管理逻辑直接写在组件里
 */
const clearScrapeQueue = (): void => {
  if (isProcessingQueue.value) {
    message.warning('请先停止处理再清空队列')
    return
  }

  clearQueue()
}

/**
 * 停止处理队列 - 队列控制逻辑直接写在组件里
 */
const stopProcessingQueue = (): void => {
  stopProcessing()
}

/**
 * 重新匹配队列中的电影 - 重新匹配逻辑直接写在组件里
 * @param task 队列任务
 */
const rematchMovie = async (
  task: any
): Promise<void> => {
  if (isProcessingQueue.value) {
    message.warning('队列处理中，无法重新匹配')
    return
  }

  try {
    // 显示手动匹配弹窗
    handleShowManualScrapeModal(task.item)
    message.info(`正在为 "${task.item.name}" 重新匹配电影`)
  } catch (error) {
    message.error('重新匹配失败')
  }
}

/**
 * 处理队列模态框关闭事件 - 模态框事件处理逻辑直接写在组件里
 */
const handleQueueModalClose = (): void => {
  // 允许在任何时候关闭模态框
  handleCloseQueueModal()

  // 如果正在处理队列，给用户提示
  if (isProcessingQueue.value) {
    message.info('队列仍在后台处理中，您可以随时重新打开查看进度')
  }
}



/**
 * 处理电影刮削：添加到队列或立即处理 - 刮削处理逻辑直接写在组件里
 * @param movie 电影数据
 */
const handleScrapeMovie = async (movie: Movie): Promise<void> => {
  addToScrapeQueue(movie)
}

/**
 * 处理自动刮削 - 自动刮削逻辑直接写在组件里，逻辑清晰
 * @param item 要刮削的项目
 */
const handleAutoScrape = async (item: ProcessedItem): Promise<void> => {
  try {
    // 调用useScraping中的searchMovieInfo函数
    const movies = await searchMovieInfo(item)
    
    if (movies && movies.length > 0) {
      // 显示搜索结果弹窗，并传递当前项目
      handleShowSearchModal(movies, item)
      message.success(`找到 ${movies.length} 个匹配结果`)
    } else {
      message.warning('未找到匹配的电影信息')
    }
  } catch (error) {
    console.error('自动刮削失败:', error)
    message.error('自动刮削失败')
  }
}

// 处理单个刮削任务 - 刮削任务处理逻辑直接写在组件里，逻辑清晰
const processSingleScrapeTask = async (movie: Movie): Promise<void> => {
  if (!currentScrapeItem.value) {
    message.error('没有选中的刮削项目')
    return
  }

  try {
    message.loading('正在处理电影文件...', 0)

    // 使用useScrapingTask中的方法
    const { processSingleScrapeTask: processTask } = useScrapingTask()
    await processTask(movie, currentScrapeItem.value)

    message.destroy()
    message.success('刮削任务完成')
  } catch (error) {
    message.destroy()
    message.error(
      `处理失败: ${error instanceof Error ? error.message : '未知错误'}`
    )
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

onMounted(() => {
  const loaded = loadFromCache()

  if (loaded) {
    // 组件启动时已从缓存加载数据
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

