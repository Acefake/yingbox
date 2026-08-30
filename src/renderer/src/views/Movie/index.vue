<template>
  <div class="folder-content relative h-full text-white overflow-hidden">
    <!-- 左侧悬浮面板 -->
    <div class="absolute left-0 top-0 bottom-0 z-20 flex flex-col">
      <LeftPanel
        :processed-items="processedItems"
        :selected-index="selectedIndex"
        :selected-path="selectedItem?.path"
        :dir-loading="dirLoading"
        :scan-progress="scanProgress"
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
        @local-scrape="handleLocalScrape"
        @download-video="handleDownloadVideo"
        @fetch-meta="handleFetchMeta"
        @play="handlePlay"
        @delete-file="handleDeleteItem"
        @scrape-all="handleScrapeAll"
      />
    </div>

    <!-- 右侧内容区域 -->
    <div
      class="absolute inset-0 z-10"
      :style="{ paddingLeft: leftPanelWidth + 32 + 'px' }"
    >
      <EmptyPlaceholder v-if="!selectedItem" />

      <div v-else class="primary-scroll p-6 h-full overflow-y-auto">
        <!-- 成人模式 + JAV 内容：使用 AdultContentPanel -->
        <AdultContentPanel
          v-if="isAdultMode && isJavContent"
          :selected-item="selectedItem"
          :meta="adultMeta"
          :poster-image-data-url="posterImageDataUrl"
          :fanart-image-data-url="fanartImageDataUrl"
          :local-fanarts="localFanarts"
          :actors="actors"
          :loading="adultScrapeLoading"
          :action-msg="adultActionMsg"
          @scrape="handleAdultScrape"
          @add-to-queue="handleAdultAddToQueue"
          @play-file="handlePlayFile"
          @delete-file="handleDeleteFile"
        />
        <!-- 普通模式：使用 RightPanel -->
        <RightPanel
          v-else
          :selected-item="selectedItem"
          :poster-image-data-url="posterImageDataUrl"
          :movie-info="movieInfo"
          :fanart-image-data-url="fanartImageDataUrl"
          :actors="actors"
          @play-file="handlePlayFile"
          @delete-file="handleDeleteFile"
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
      @manual-search="handleShowManualScrapeModal"
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
import { computed, onMounted, ref, watch } from 'vue'
import EmptyPlaceholder from '@/components/EmptyPlaceholder.vue'
import { backend, type BackendMeta } from '@/api/backend'
import { Modal, message } from 'ant-design-vue'
import { ProcessedItem } from '@/types'
import type { ScrapedMovie } from '@/types/scraping'
import RightPanel from '@/views/Movie/RightPanel.vue'
import AdultContentPanel from '@/views/Movie/components/AdultContentPanel.vue'
import LeftPanel from '@/views/Movie/components/LeftPanel.vue'
import MediaSearchModal from '@/components/MediaSearchModal.vue'
import type { MediaResult } from '@/components/MediaSearchModal.vue'
import ManualScrapeModal from '@/views/Movie/components/ManualScrapeModal.vue'
import DownloadModal from '@/views/Movie/components/DownloadModal.vue'
import MetaPreviewModal from '@/views/Movie/components/MetaPreviewModal.vue'
import JavBusScrapeModal from '@/views/Movie/components/JavBusScrapeModal.vue'
import { getScrapeProviderConfig } from '@/stores/scrape-provider-store'
import { useScraping } from '@/views/Movie/composables/use-scraping'
import { useFileManagement } from '@/views/Movie/composables/use-file-management'
import {
  useMediaProcessing,
  bumpScrapeVersion,
} from '@/views/Movie/composables/use-media-processing'
import { useScrapingTask } from '@/views/Movie/composables/use-scraping-task'
import { useGlobalQueue } from '@/composables/use-global-queue'
import { extractAvid } from '@/utils/avid'
import { toLocalUrl } from '@/utils/local-url'
import { parseNfo } from '@/services/nfo-service'

const { searchMovieInfo } = useScraping()
const { scrape } = useScrapingTask()
const { isProcessing: queueActive } = useGlobalQueue()

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

// 成人模式状态
const isAdultMode = ref(localStorage.getItem('adultMode') === '1')
const adultMeta = ref<BackendMeta | null>(null)
const adultMetaLoading = ref(false)  // 获取预览元数据加载状态
const adultScrapeLoading = ref(false) // 执行刮削操作加载状态
const adultActionMsg = ref('')

/**
 * 构建 JavBus ScrapedMovie 对象（消除多处重复构造）
 */
const buildJavBusMovie = (meta: BackendMeta): ScrapedMovie => ({
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
})

// 检测是否为 JAV 内容（文件名匹配 JAV 格式）
const isJavContent = computed(() => {
  const name = selectedItem.value?.name || ''
  // 匹配类似 XXX-123, XXX-1234, XXX_123 等格式
  return /[A-Z]{2,6}[-_]?\s*\d{2,4}/i.test(name)
})

// 检测本地 fanarts 图片
const localFanarts = computed(() => {
  const item = selectedItem.value
  if (!item?.path) return []

  const isFolder = item.type === 'folder'
  const baseName = isFolder ? item.name : item.name.replace(/\.[^.]+$/, '')

  // 扫描本地文件中的 fanart 图片
  const fanarts: string[] = []
  if (item.files) {
    // 优先查找以 baseName-fanart 开头的图片
    for (const file of item.files) {
      if (!file.isFile) continue
      const name = file.name.toLowerCase()
      // 匹配 fanart 图片命名：xxx-fanart.jpg, xxx-fanart-1.jpg, xxx-fanart-2.jpg 等
      if (name.startsWith(baseName.toLowerCase()) && name.includes('fanart') && /\.(jpg|jpeg|png|webp)$/i.test(name)) {
        fanarts.push(file.path)
      }
    }
  }
  return fanarts.sort()  // 按名称排序
})

/**
 * 检测项目是否已刮削（NFO + 海报 + fanart 均存在）
 */
const isAlreadyScraped = (item: ProcessedItem): boolean => {
  if (!item.files) return false
  const hasNfo = item.files.some(f => f.name.toLowerCase().endsWith('.nfo'))
  const hasPoster = item.files.some(f => {
    const n = f.name.toLowerCase()
    return n.includes('poster') || n === 'folder.jpg' || n === 'movie.jpg'
  })
  const hasFanart = item.files.some(f => {
    const n = f.name.toLowerCase()
    return n.includes('fanart') || n.includes('backdrop')
  })
  return hasNfo && hasPoster && hasFanart
}

/**
 * 从本地 NFO 文件构建 BackendMeta（避免重复网络请求）
 */
const buildMetaFromLocal = async (item: ProcessedItem): Promise<BackendMeta | null> => {
  if (!item.files) return null
  const nfoFile = item.files.find(f => f.name.toLowerCase().endsWith('.nfo'))
  if (!nfoFile) return null

  try {
    const result = await window.api.file.read(nfoFile.path)
    if (!result.success || !result.data) return null
    const nfo = parseNfo(result.data as string)

    const avid = extractAvid(item.name) || item.name

    // 构建 actress map
    const actress: Record<string, string> = {}
    for (const actor of nfo.actors || []) {
      actress[actor.name] = actor.thumb || ''
    }

    // 本地 fanart 文件
    const fanarts: string[] = []
    for (const f of item.files) {
      const fn = f.name.toLowerCase()
      if ((fn.includes('fanart') || fn.includes('backdrop')) && /\.(jpg|jpeg|png|webp)$/i.test(fn)) {
        fanarts.push(toLocalUrl(f.path))
      }
    }

    // 本地海报
    const posterFile = item.files.find(f => {
      const n = f.name.toLowerCase()
      return (n.includes('poster') || n === 'folder.jpg' || n === 'movie.jpg') && /\.(jpg|jpeg|png|webp)$/i.test(n)
    })

    return {
      avid,
      title: nfo.title || '',
      cover: posterFile ? toLocalUrl(posterFile.path) : '',
      release_date: nfo.premiered || nfo.year || '',
      duration: nfo.runtime || '',
      description: nfo.plot || nfo.outline || '',
      keywords: nfo.genres || [],
      actress,
      fanarts,
      magnets: [],
    }
  } catch {
    return null
  }
}

// 监听选中项变化，成人模式下自动获取 JAV 元数据
watch(selectedItem, async (item) => {
  if (!item || !isAdultMode.value || !isJavContent.value) {
    adultMeta.value = null
    return
  }

  // 已刮削 → 直接读本地 NFO，跳过网络请求
  if (isAlreadyScraped(item)) {
    const localMeta = await buildMetaFromLocal(item)
    if (localMeta) {
      adultMeta.value = localMeta
      adultMetaLoading.value = false
      return
    }
  }

  // 未刮削 → 从接口获取
  const avid = extractAvid(item.name)
  if (!avid) return

  adultMetaLoading.value = true
  try {
    const data = await backend.fetchMeta(avid)
    if (!data.error) {
      adultMeta.value = data
      if (!isAlreadyScraped(item) && !adultScrapeLoading.value) {
        handleAdultScrape(data, item)
      }
    }
  } catch (e) {
    console.error('获取成人内容元数据失败:', e)
  } finally {
    adultMetaLoading.value = false
  }
})

// 成人模式刮削处理 - 使用与 JavBusScrapeModal 相同的逻辑
const handleAdultScrape = async (
  meta: BackendMeta,
  item: ProcessedItem
): Promise<void> => {
  if (!meta || !item) return
  adultActionMsg.value = ''
  adultScrapeLoading.value = true
  currentScrapeItem.value = item

  scrape(buildJavBusMovie(meta), item)
  adultScrapeLoading.value = false
  adultActionMsg.value = '✅ 已加入队列'
}

// 成人模式添加到队列
const handleAdultAddToQueue = (): void => {
  if (!adultMeta.value || !selectedItem.value) return
  // 使用现有的 JavBus 队列逻辑
  handleJavBusAddToQueue(adultMeta.value as any, selectedItem.value)
  adultActionMsg.value = '✅ 已加入队列'
}

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
  }
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
const selectItem = (item: ProcessedItem, rootItem: number | ProcessedItem): void => {
  const index = typeof rootItem === 'number' ? rootItem : -1
  if (selectedItem.value?.path === item.path) {
    selectedItem.value = null
    selectedIndex.value = -1
  } else {
    selectedItem.value = item
    selectedIndex.value = index
  }
  // 预加载相邻项
  preloadAdjacentItems(index)
}

/**
 * 预加载当前项前后的相邻项（NFO + 图片），让切换更丝滑
 */
const PRELOAD_RANGE = 3 // 预加载前后各 3 项
const preloadedSet = new Set<string>()

function preloadAdjacentItems(centerIndex: number): void {
  const items = processedItems.value
  if (!items.length) return

  const start = Math.max(0, centerIndex - PRELOAD_RANGE)
  const end = Math.min(items.length - 1, centerIndex + PRELOAD_RANGE)

  const tasks: (() => Promise<void>)[] = []
  for (let i = start; i <= end; i++) {
    const it = items[i]
    if (!it || preloadedSet.has(it.path)) continue
    preloadedSet.add(it.path)

    // NFO 缓存预热
    if (it.files) {
      const nfo = it.files.find(f => f.name.toLowerCase().endsWith('.nfo'))
      if (nfo) {
        const nfoPath = nfo.path
        tasks.push(async () => {
          try {
            const r = await window.api.file.read(nfoPath)
            if (r.success && r.data) {
              // use-media-processing 内部有 nfoCache，直接读即可
            }
          } catch {}
        })
      }
    }

    // 图片预加载到浏览器缓存
    if (it.files) {
      for (const f of it.files) {
        const fn = f.name.toLowerCase()
        if (/\.(jpg|jpeg|png|webp)$/i.test(fn)) {
          const url = toLocalUrl(f.path)
          const img = new Image()
          img.src = url
        }
      }
    }
  }

  // NFO 读取放到空闲时间
  if (tasks.length) {
    const runTasks = () => {
      for (const t of tasks) t()
    }
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(runTasks, { timeout: 1000 })
    } else {
      setTimeout(runTasks, 50)
    }
  }
}


// 队列全部完成时统一刷新一次（避免每个任务单独刷新）
let wasQueueActive = false
watch(queueActive, (active) => {
  if (wasQueueActive && !active) {
    wasQueueActive = false
    bumpScrapeVersion()
    refreshAfterScrape(currentDirectoryPath.value).then(async () => {
      message.success('刮削完成，文件列表已刷新')
      // 刷新成人元数据
      if (selectedItem.value && isAdultMode.value) {
        const localMeta = await buildMetaFromLocal(selectedItem.value)
        if (localMeta) adultMeta.value = localMeta
      }
    })
  }
  if (active) wasQueueActive = true
})

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
const handlePickMovie = async (movie: MediaResult): Promise<void> => {
  showSearchModal.value = false
  if (!currentScrapeItem.value) return
  scrape(movie as ScrapedMovie, currentScrapeItem.value)
}

/**
 * 处理自动刮削 - 自动刮削逻辑直接写在组件里，逻辑清晰
 * @param item 要刮削的项目
 */
const handleAutoScrape = async (item: ProcessedItem): Promise<void> => {
  const provider = getScrapeProviderConfig().provider

  // JavBus：使用独立刮削预览弹窗
  if (provider === 'javbus') {
    const avid = extractAvid(item.name)
    if (!avid) return
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
  scrape(buildJavBusMovie(meta), item)
  javBusScrapeModal.value?.setResult(`✅ 已加入队列`)
}

/**
 * JavBus 加入队列
 */
const handleJavBusAddToQueue = (
  movie: ScrapedMovie,
  item: ProcessedItem
): void => {
  currentScrapeItem.value = item
  scrape(movie, item)
  javBusScrapeModal.value?.setResult(`✅ 已加入队列`)
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
        // 直接调用刮削任务（不等待，由队列调度器并发执行）
        scrape(movies[0], item)
      } else {
        handleShowSearchModal(movies, item)
      }
    }
  } catch (error) {
    console.error('直接刮削失败:', error)
  }
}

// 本地刮削
const handleLocalScrape = async (item: ProcessedItem): Promise<void> => {
  const avid = extractAvid(item.name)
  if (!avid) {
    message.error('无法从文件名中提取 AV 号')
    return
  }
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

// 一键刮削所有未元数据项
const handleScrapeAll = async (): Promise<void> => {
  const provider = getScrapeProviderConfig().provider

  // 找出没有 NFO 文件的项
  const unscraped = processedItems.value.filter(item => {
    if (!item.files) return true
    return !item.files.some(f => f.name.toLowerCase().endsWith('.nfo'))
  })

  if (unscraped.length === 0) {
    message.info('所有项目都已有元数据')
    return
  }

  Modal.confirm({
    title: '一键刮削',
    content: `将对 ${unscraped.length} 个未元数据的项目执行刮削，是否继续？`,
    okText: '开始刮削',
    cancelText: '取消',
    async onOk() {
      if (provider === 'javbus') {
        // 并行获取所有元数据，再统一入队
        const metas = await Promise.all(
          unscraped.map(async item => {
            const avid = extractAvid(item.name)
            if (!avid) return { item, meta: null }
            try {
              const data = await backend.fetchMeta(avid)
              return { item, meta: data.error ? null : data }
            } catch {
              return { item, meta: null }
            }
          })
        )
        for (const { item, meta } of metas) {
          if (meta) scrape(buildJavBusMovie(meta), item)
        }
      } else {
        for (const item of unscraped) {
          handleAutoScrape(item)
        }
      }
      message.success(`已将 ${unscraped.length} 个项目加入刮削队列`)
    },
  })
}

// 下载视频
const handleDownloadVideo = (item: ProcessedItem): void => {
  const avid = extractAvid(item.name)
  if (!avid) return
  downloadAvid.value = avid
  showDownloadModal.value = true
}

const handleFetchMeta = (item: ProcessedItem): void => {
  const avid = extractAvid(item.name)
  if (!avid) return
  metaPreviewAvid.value = avid
  showMetaPreviewModal.value = true
}

const handleDownloadDone = (_avid: string, msg: string): void => {
  message.success(msg || '已提交下载任务')
}

const handlePlay = async (item: ProcessedItem): Promise<void> => {
  let filePath = item.path

  // 如果是文件夹，找到里面的视频文件
  if (item.type === 'folder' && item.files) {
    const videoFile = item.files.find(f =>
      f.isFile && /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i.test(f.name)
    )
    if (videoFile) {
      filePath = videoFile.path
    } else {
      message.error('未找到视频文件')
      return
    }
  }

  await playVideoFile(filePath)
}

/** 播放指定路径的视频文件 */
const playVideoFile = async (filePath: string): Promise<void> => {
  const videoPlayer = localStorage.getItem('videoPlayer') || 'builtin'
  const api = (window as any).api

  if (videoPlayer === 'builtin') {
    if (api?.player?.open) {
      const result = await api.player.open(filePath)
      if (!result.success) {
        message.error('播放失败')
      }
    } else {
      message.error('内置播放器 API 不可用')
    }
  } else {
    if (api?.shell?.openPath) {
      const result = await api.shell.openPath(filePath)
      if (!result.success) {
        message.error('播放失败: ' + (result.error || '未知错误'))
      }
    } else {
      message.error('Shell API 不可用')
    }
  }
}

/** RightPanel 播放指定视频文件 */
const handlePlayFile = (filePath: string): void => {
  playVideoFile(filePath)
}

/** RightPanel 删除指定视频文件 */
const handleDeleteFile = (filePath: string): void => {
  const fileName = filePath.split(/[/\\]/).pop() || filePath
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除 "${fileName}" 吗？此操作不可恢复。`,
    okText: '删除',
    cancelText: '取消',
    okType: 'danger',
    async onOk() {
      const result = await window.api.file.delete(filePath)
      if (result.success) {
        message.success('已删除')
        bumpScrapeVersion()
        await refreshAfterScrape(currentDirectoryPath.value)
      } else {
        message.error('删除失败: ' + (result.error || '未知错误'))
      }
    },
  })
}

/** 左侧树右键删除文件/文件夹 */
const handleDeleteItem = (item: ProcessedItem): void => {
  const isDir = item.type === 'folder'
  const typeLabel = isDir ? '文件夹' : '文件'
  Modal.confirm({
    title: `确认删除${typeLabel}`,
    content: `确定要删除"${item.name}"吗？${isDir ? '文件夹内所有内容都将被删除，' : ''}此操作不可恢复。`,
    okText: '删除',
    cancelText: '取消',
    okType: 'danger',
    async onOk() {
      const result = await window.api.file.delete(item.path)
      if (result.success) {
        message.success('已删除')
        // 如果删除的是当前选中项，清除选中
        if (selectedItem.value?.path === item.path) {
          selectedItem.value = null
          selectedIndex.value = -1
        }
        bumpScrapeVersion()
        await refreshAfterScrape(currentDirectoryPath.value)
      } else {
        message.error('删除失败: ' + (result.error || '未知错误'))
      }
    },
  })
}

onMounted(() => {
  const loaded = loadFromCache()

  if (loaded) {
    // 组件启动时已从缓存加载数据，初始化 processedItems
    updateProcessedItems()
    // 预加载前几项
    if (processedItems.value.length > 0) {
      preloadAdjacentItems(0)
    }
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
