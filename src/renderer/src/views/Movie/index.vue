<template>
  <div
    class="yb-media-shell folder-content"
    :class="{ 'has-selection': Boolean(selectedItem) }"
  >
    <!-- 左侧媒体库列表 -->
    <div class="yb-media-list-pane">
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
        @scrape="openScrapeWorkbench"
        @auto-scrape="openScrapeWorkbench"
        @play="handlePlay"
        @delete-file="handleDeleteItem"
        @scrape-all="handleScrapeAll"
      />
    </div>

    <!-- 右侧内容区域 -->
    <div class="yb-media-detail-pane">
      <EmptyPlaceholder v-if="!selectedItem" />

      <div v-else class="yb-media-canvas primary-scroll">
        <!-- 普通模式：使用 RightPanel -->
        <RightPanel
          :selected-item="selectedItem"
          :poster-image-data-url="posterImageDataUrl"
          :movie-info="movieInfo"
          :fanart-image-data-url="fanartImageDataUrl"
          :actors="actors"
          @open-workbench="openScrapeWorkbench"
          @play-file="handlePlayFile"
          @delete-file="handleDeleteFile"
        />
      </div>
    </div>

    <!-- 统一刮削工作台 -->
    <ScrapeWorkbenchModal
      :visible="showScrapeWorkbench"
      :item="currentScrapeItem"
      :initial-query="scrapeWorkbenchQuery"
      @close="closeScrapeWorkbench"
      @scrape="handleWorkbenchScrape"
    />

    <!-- 统一本地播放器：body + 全局高 z-index，避免被侧栏/标题栏/队列压住 -->
    <Teleport to="body">
      <Transition name="sheet-fade">
        <div
          v-if="showLocalPlayer"
          class="yb-local-player-overlay"
          @click.self="closeLocalPlayer"
        >
          <div class="yb-local-player-stage">
            <UnifiedVideoPlayer
              :src="localPlayerUrl"
              :title="localPlayerTitle"
              closable
              @close="closeLocalPlayer"
            />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { confirmDialog } from '@/utils/confirm-dialog'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EmptyPlaceholder from '@/components/EmptyPlaceholder.vue'
import { message } from 'ant-design-vue'
import { ProcessedItem } from '@/types'
import type { ScrapedMovie } from '@/types/scraping'
import RightPanel from '@/views/Movie/RightPanel.vue'
import LeftPanel from '@/views/Movie/components/LeftPanel.vue'
import ScrapeWorkbenchModal from '@/views/Movie/components/ScrapeWorkbenchModal.vue'
import { useScraping } from '@/views/Movie/composables/use-scraping'
import { useFileManagement } from '@/views/Movie/composables/use-file-management'
import {
  bumpScrapeVersion,
  useMediaProcessing,
} from '@/views/Movie/composables/use-media-processing'
import {
  onScrapedFolder,
  useScrapingTask,
} from '@/views/Movie/composables/use-scraping-task'
import { useGlobalQueue } from '@/composables/use-global-queue'
import { toLocalUrl } from '@/utils/local-url'
import { openMediaPlayer } from '@/composables/use-media-player'
import { parseNfo } from '@/services/nfo-service'
import UnifiedVideoPlayer from '@/components/UnifiedVideoPlayer.vue'

const { searchMovieInfo } = useScraping()
const { scrape } = useScrapingTask()
const { isProcessing: queueActive } = useGlobalQueue()

/** 队列期间收集刮削产出的电影文件夹，结束时做局部刷新 */
const pendingScrapedFolders = new Set<string>()
const stopScrapedFolderListener = onScrapedFolder(folderPath => {
  if (folderPath) pendingScrapedFolders.add(folderPath)
})

// 统一刮削工作台状态
const showScrapeWorkbench = ref(false)
const scrapeWorkbenchQuery = ref('')
const currentScrapeItem = ref<ProcessedItem | null>(null)
/** 一键刮削：多结果项顺序打开工作台 */
const pendingAmbiguousQueue = ref<ProcessedItem[]>([])

// 统一播放器状态
const showLocalPlayer = ref(false)
const localPlayerUrl = ref('')
const localPlayerTitle = ref('本地视频')

// 左侧边栏状态
const selectedIndex = ref(-1)

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
const { posterImageDataUrl, fanartImageDataUrl, movieInfo, actors } =
  useMediaProcessing(selectedItem)

// Keep list title in sync when detail loads / refreshes NFO
watch(movieInfo, info => {
  if (!info?.title || !selectedItem.value) return
  patchProcessedItemMeta(selectedItem.value.path, String(info.title), info.year)
})

/** Concurrency-limited NFO title enrichment for list/detail parity */
let enrichMetaToken = 0

const findItemNfoPath = (item: ProcessedItem): string | null => {
  if (!item.files?.length) return null
  const base =
    item.type === 'video'
      ? item.name.replace(/\.[^/.]+$/, '').toLowerCase()
      : item.name.toLowerCase()
  const nfos = item.files.filter(f => f.name.toLowerCase().endsWith('.nfo'))
  if (!nfos.length) return null
  const matched = nfos.find(f => f.name.toLowerCase().includes(base))
  return (matched || nfos[0]).path
}

const patchProcessedItemMeta = (
  itemPath: string,
  metaTitle: string,
  metaYear?: string
): void => {
  const title = metaTitle.trim()
  if (!title) return
  const year = (metaYear || '').trim() || undefined
  const pos = processedItems.value.findIndex(i => i.path === itemPath)
  if (pos < 0) return
  const cur = processedItems.value[pos]
  if (cur.metaTitle === title && cur.metaYear === year) return
  const updated: ProcessedItem = { ...cur, metaTitle: title, metaYear: year }
  const next = processedItems.value.slice()
  next[pos] = updated
  processedItems.value = next
  if (selectedItem.value?.path === itemPath) {
    selectedItem.value = updated
  }
}

const enrichMetaTitles = async (items: ProcessedItem[]): Promise<void> => {
  const token = ++enrichMetaToken
  const targets = items.filter(i => i.hasNfo && !i.metaTitle)
  if (!targets.length) return

  const CONCURRENCY = 5
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      if (token !== enrichMetaToken) return
      const item = targets[cursor++]
      const nfoPath = findItemNfoPath(item)
      if (!nfoPath) continue
      try {
        const result = await window.api.file.read(nfoPath)
        if (token !== enrichMetaToken) return
        if (!result.success || !result.data) continue
        const parsed = parseNfo(result.data as string)
        const title = (parsed.title || '').trim()
        if (!title) continue
        patchProcessedItemMeta(item.path, title, parsed.year)
      } catch {
        // ignore individual NFO read failures
      }
    }
  }

  const n = Math.min(CONCURRENCY, targets.length)
  await Promise.all(Array.from({ length: n }, () => worker()))
}

// 计算属性改为 ref，支持直接修改
const processedItems = ref<ProcessedItem[]>([])

// 初始化 processedItems
const updateProcessedItems = (): void => {
  const prevMeta = new Map(
    processedItems.value
      .filter(i => i.metaTitle)
      .map(i => [i.path, { metaTitle: i.metaTitle!, metaYear: i.metaYear }])
  )
  const items = processFiles(fileData.value)
  // 已有 NFO 与海报的项目置顶，背景图不影响排序。
  items.sort(
    (a, b) =>
      Number(Boolean(b.hasNfo && b.hasPoster)) -
      Number(Boolean(a.hasNfo && a.hasPoster))
  )
  for (const item of items) {
    const prev = prevMeta.get(item.path)
    if (prev) {
      item.metaTitle = prev.metaTitle
      item.metaYear = prev.metaYear
    }
  }
  processedItems.value = items
  // Don't block first paint — enrich NFO titles asynchronously
  void enrichMetaTitles(items)
}

// fileData 变化时自动同步（覆盖所有刷新路径，包括队列处理器）
watch(fileData, () => {
  updateProcessedItems()
  // 刷新后把 selectedItem 指向新扫描对象，使 fanartImagePath 能读到最新 files
  if (selectedItem.value) {
    const refreshed = processedItems.value.find(
      i => i.path === selectedItem.value!.path
    )
    if (refreshed) selectedItem.value = refreshed
  }
})

// 包装 readDirectory，读取后更新 processedItems
const handleReadDirectory = async (): Promise<void> => {
  await readDirectory()
  updateProcessedItems()
}

// 统一刮削工作台
const openScrapeWorkbench = (
  item: ProcessedItem,
  initialQuery?: string
): void => {
  currentScrapeItem.value = item
  scrapeWorkbenchQuery.value = (initialQuery || '').trim()
  showScrapeWorkbench.value = true
}

const openNextAmbiguousWorkbench = async (): Promise<void> => {
  const next = pendingAmbiguousQueue.value.shift()
  if (!next) return
  showScrapeWorkbench.value = false
  scrapeWorkbenchQuery.value = ''
  await nextTick()
  openScrapeWorkbench(next)
}

const closeScrapeWorkbench = (): void => {
  showScrapeWorkbench.value = false
  scrapeWorkbenchQuery.value = ''
  if (pendingAmbiguousQueue.value.length > 0) {
    void openNextAmbiguousWorkbench()
  }
}

const handleWorkbenchScrape = (
  movie: ScrapedMovie,
  item: ProcessedItem
): void => {
  currentScrapeItem.value = item
  scrape(movie, item)
  // 批量歧义队列：选用后继续下一项
  if (pendingAmbiguousQueue.value.length > 0) {
    void openNextAmbiguousWorkbench()
  }
}

// 左侧边栏管理方法 - 这些逻辑都是组件特有的，直接写在组件里更清晰
const selectItem = (
  item: ProcessedItem,
  rootItem: number | ProcessedItem
): void => {
  const index = typeof rootItem === 'number' ? rootItem : -1
  if (selectedItem.value?.path === item.path) {
    selectedItem.value = null
    selectedIndex.value = -1
  } else {
    selectedItem.value = item
    selectedIndex.value = index
  }
}

// 队列全部完成时统一刷新一次（优先局部刷新刮削目标文件夹）
let wasQueueActive = false
watch(queueActive, active => {
  if (wasQueueActive && !active) {
    wasQueueActive = false
    bumpScrapeVersion()
    const folders = [...pendingScrapedFolders]
    pendingScrapedFolders.clear()
    const refreshJob =
      folders.length > 0
        ? (async () => {
            for (const folder of folders) {
              await refreshAfterScrape(folder)
            }
          })()
        : refreshAfterScrape(currentDirectoryPath.value)
    refreshJob.then(async () => {
      message.success('刮削完成，文件列表已刷新')
    })
  }
  if (active) wasQueueActive = true
})

/**
 * 显示清除缓存确认对话框 - 弹窗逻辑直接写在组件里
 */
const handleShowClearCacheDialog = (): void => {
  confirmDialog({
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

/** 简单的并发限制 map：保证同一时刻最多 limit 个任务在跑 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index++
      results[current] = await fn(items[current])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  )
  return results
}

// 一键刷削所有未元数据项：先入队明确匹配，歧义项顺序打开工作台
const handleScrapeAll = async (): Promise<void> => {

  // 找出没有 NFO 文件的项
  const unscraped = processedItems.value.filter(item => {
    if (!item.files) return true
    return !item.files.some(f => f.name.toLowerCase().endsWith('.nfo'))
  })

  if (unscraped.length === 0) {
    message.info('所有项目都已有元数据')
    return
  }

  confirmDialog({
    title: '刮削未匹配',
    content: `将对 ${unscraped.length} 个未匹配项目执行刮削。唯一结果自动入队，多结果稍后逐个确认。`,
    okText: '开始',
    cancelText: '取消',
    async onOk() {
      pendingAmbiguousQueue.value = []

      // TMDB / 自定义：并发限制搜索，唯一结果自动入队；0 计失败；>1 收集后顺序打开工作台
      let queued = 0
      let failed = 0
      const needsChoice: ProcessedItem[] = []

      await mapWithConcurrency(unscraped, 4, async item => {
        try {
          const movies = await searchMovieInfo(item)
          if (movies && movies.length === 1) {
            scrape(movies[0], item)
            queued += 1
          } else if (movies && movies.length > 1) {
            needsChoice.push(item)
          } else {
            failed += 1
          }
        } catch (error) {
          console.error('一键刷削失败:', error)
          failed += 1
        }
      })

      pendingAmbiguousQueue.value = needsChoice
      const needManual = needsChoice.length
      const parts = [`已入队 ${queued}`]
      if (failed > 0) parts.push(`无结果 ${failed}`)
      if (needManual > 0) parts.push(`待手动 ${needManual}`)
      message.success(parts.join(' · '))

      if (needsChoice.length > 0) {
        const first = pendingAmbiguousQueue.value.shift()!
        openScrapeWorkbench(first)
      }
    },
  })
}

const handlePlay = async (item: ProcessedItem): Promise<void> => {
  let filePath = item.path

  // 如果是文件夹，找到里面的视频文件
  if (item.type === 'folder' && item.files) {
    const videoFile = item.files.find(
      f => f.isFile && /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i.test(f.name)
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
  const title = filePath.split(/[/\\]/).pop() || '本地视频'
  // Electron: 独立播放窗口，避开 AppLayout 侧栏/标题栏遮挡
  if (await openMediaPlayer({ filePath, title })) return
  // Web / 无 player API：保留应用内 Teleport 浮层
  localPlayerUrl.value = toLocalUrl(filePath)
  localPlayerTitle.value = title
  showLocalPlayer.value = true
}

const closeLocalPlayer = (): void => {
  showLocalPlayer.value = false
  localPlayerUrl.value = ''
}

/** RightPanel 播放指定视频文件 */
const handlePlayFile = (filePath: string): void => {
  playVideoFile(filePath)
}

/** RightPanel 删除指定视频文件 */
const handleDeleteFile = (filePath: string): void => {
  const fileName = filePath.split(/[/\\]/).pop() || filePath
  confirmDialog({
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
        const parent = filePath.replace(/[\\/][^\\/]+$/, '')
        await refreshAfterScrape(parent || currentDirectoryPath.value)
      } else {
        message.error(`删除失败: ${result.error || '未知错误'}`)
      }
    },
  })
}

/** 左侧树右键删除文件/文件夹 */
const handleDeleteItem = (item: ProcessedItem): void => {
  const isDir = item.type === 'folder'
  const typeLabel = isDir ? '文件夹' : '文件'
  confirmDialog({
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
        const parent = item.path.replace(/[\\/][^\\/]+$/, '')
        await refreshAfterScrape(parent || currentDirectoryPath.value)
      } else {
        message.error(`删除失败: ${result.error || '未知错误'}`)
      }
    },
  })
}

const handleNavigateBack = (event: Event) => {
  if (!selectedItem.value) return
  selectedItem.value = null
  selectedIndex.value = -1
  event.preventDefault()
}

onMounted(() => {
  window.addEventListener('app:navigate-back', handleNavigateBack)

  void loadFromCache().then(loaded => {
    if (loaded) {
      // 组件启动时已从缓存加载数据，初始化 processedItems
      updateProcessedItems()
    }
  })
})

onBeforeUnmount(() => {
  stopScrapedFolderListener()
  window.removeEventListener('app:navigate-back', handleNavigateBack)
})
</script>

<style scoped>
.folder-item {
  transition: var(--transition-fast);
}

.folder-item:hover {
  transform: none;
}

.empty-state {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.selected-item {
  background: var(--selection-bg);
  transition: var(--transition-normal);
}
.folder-content {
  color: var(--text-primary);
}
</style>
