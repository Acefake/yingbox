<template>
  <div class="yb-media-shell folder-content" :class="{ 'has-selection': Boolean(selectedItem) }">
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
          @open-workbench="openScrapeWorkbench"
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
            <UnifiedVideoPlayer :src="localPlayerUrl" :title="localPlayerTitle" closable @close="closeLocalPlayer" />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EmptyPlaceholder from '@/components/EmptyPlaceholder.vue'
import { type BackendMeta, backend } from '@/api/backend'
import { Modal, message } from 'ant-design-vue'
import { ProcessedItem } from '@/types'
import type { ScrapedMovie } from '@/types/scraping'
import RightPanel from '@/views/Movie/RightPanel.vue'
import AdultContentPanel from '@/views/Movie/components/AdultContentPanel.vue'
import LeftPanel from '@/views/Movie/components/LeftPanel.vue'
import ScrapeWorkbenchModal from '@/views/Movie/components/ScrapeWorkbenchModal.vue'
import { getScrapeProviderConfig } from '@/stores/scrape-provider-store'
import { useScraping } from '@/views/Movie/composables/use-scraping'
import { useFileManagement } from '@/views/Movie/composables/use-file-management'
import {
  bumpScrapeVersion,
  useMediaProcessing,
} from '@/views/Movie/composables/use-media-processing'
import { onScrapedFolder, useScrapingTask } from '@/views/Movie/composables/use-scraping-task'
import { useGlobalQueue } from '@/composables/use-global-queue'
import { extractAvid } from '@/utils/avid'
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
const {
  posterImageDataUrl,
  fanartImageDataUrl,
  movieInfo,
  actors,
} = useMediaProcessing(selectedItem)

// 成人模式状态（与 LeftPanel / AppLayout 同步：CustomEvent + storage）
const isAdultMode = ref(localStorage.getItem('adultMode') === '1')
const syncAdultMode = (): void => {
  isAdultMode.value = localStorage.getItem('adultMode') === '1'
}
const onAdultModeChange = (): void => {
  syncAdultMode()
}
const onAdultStorageChange = (event: StorageEvent): void => {
  if (event.key === 'adultMode') syncAdultMode()
}
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

let adultMetaRequestId = 0

// 监听选中项 / 成人模式变化：先完成选中渲染，再异步读取元数据。
watch([selectedItem, isAdultMode], async ([item]) => {
  const requestId = ++adultMetaRequestId
  if (!item || !isAdultMode.value || !isJavContent.value) {
    adultMeta.value = null
    adultMetaLoading.value = false
    return
  }

  // 已刮削 → 直接读本地 NFO，跳过网络请求
  if (isAlreadyScraped(item)) {
    const localMeta = await buildMetaFromLocal(item)
    if (requestId !== adultMetaRequestId) return
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
    if (requestId !== adultMetaRequestId) return
    if (!data.error) {
      adultMeta.value = data
    }
  } catch (e) {
    if (requestId === adultMetaRequestId) {
      console.error('获取成人内容元数据失败:', e)
    }
  } finally {
    if (requestId === adultMetaRequestId) {
      adultMetaLoading.value = false
    }
  }
})


// Keep list title in sync when detail loads / refreshes NFO
watch(movieInfo, (info) => {
  if (!info?.title || !selectedItem.value) return
  patchProcessedItemMeta(selectedItem.value.path, String(info.title), info.year)
})

// Adult meta title → same list/detail parity
watch(adultMeta, (meta) => {
  if (!meta?.title || !selectedItem.value) return
  patchProcessedItemMeta(selectedItem.value.path, String(meta.title))
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
  adultActionMsg.value = '✅ 已加入刮削队列'
}


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
    (a, b) => Number(Boolean(b.hasNfo && b.hasPoster)) - Number(Boolean(a.hasNfo && a.hasPoster))
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
}

// 统一刮削工作台
const openScrapeWorkbench = (item: ProcessedItem, initialQuery?: string): void => {
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

const handleWorkbenchScrape = (movie: ScrapedMovie, item: ProcessedItem): void => {
  currentScrapeItem.value = item
  scrape(movie, item)
  // 批量歧义队列：选用后继续下一项
  if (pendingAmbiguousQueue.value.length > 0) {
    void openNextAmbiguousWorkbench()
  }
}

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
}


// 队列全部完成时统一刷新一次（优先局部刷新刮削目标文件夹）
let wasQueueActive = false
watch(queueActive, (active) => {
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

// 一键刮削所有未元数据项：先入队明确匹配，歧义项顺序打开工作台
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
    title: '刮削未匹配',
    content: `将对 ${unscraped.length} 个未匹配项目执行刮削。唯一结果自动入队，多结果稍后逐个确认。`,
    okText: '开始',
    cancelText: '取消',
    async onOk() {
      pendingAmbiguousQueue.value = []

      if (provider === 'javbus') {
        // 并行获取所有元数据，再统一入队
        const metas = await Promise.all(
          unscraped.map(async item => {
            const avid = extractAvid(item.name)
            if (!avid) return { item, meta: null as BackendMeta | null, skipped: true, failed: false }
            try {
              const data = await backend.fetchMeta(avid)
              return { item, meta: data.error ? null : data, skipped: false, failed: Boolean(data.error) }
            } catch {
              return { item, meta: null, skipped: false, failed: true }
            }
          })
        )
        let queued = 0
        let skipped = 0
        let failed = 0
        for (const { item, meta, skipped: wasSkipped, failed: wasFailed } of metas) {
          if (wasSkipped) {
            skipped += 1
            continue
          }
          if (meta) {
            scrape(buildJavBusMovie(meta), item)
            queued += 1
          } else if (wasFailed) {
            failed += 1
          }
        }
        const parts = [`已入队 ${queued}`]
        if (skipped > 0) parts.push(`跳过无番号 ${skipped}`)
        if (failed > 0) parts.push(`失败 ${failed}`)
        message.success(parts.join(' · '))
        if (skipped > 0) {
          message.warning(`有 ${skipped} 项无法识别番号，可右键「刮削」手动处理`)
        }
        return
      }

      // TMDB / 自定义：唯一结果自动入队；0 计失败；>1 收集后顺序打开工作台
      let queued = 0
      let failed = 0
      const needsChoice: ProcessedItem[] = []

      for (const item of unscraped) {
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
          console.error('一键刮削失败:', error)
          failed += 1
        }
      }

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
        const parent = filePath.replace(/[\\/][^\\/]+$/, '')
        await refreshAfterScrape(parent || currentDirectoryPath.value)
      } else {
        message.error(`删除失败: ${  result.error || '未知错误'}`)
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
        const parent = item.path.replace(/[\\/][^\\/]+$/, '')
        await refreshAfterScrape(parent || currentDirectoryPath.value)
      } else {
        message.error(`删除失败: ${  result.error || '未知错误'}`)
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
  window.addEventListener('adultModeChange', onAdultModeChange)
  window.addEventListener('storage', onAdultStorageChange)
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
  window.removeEventListener('adultModeChange', onAdultModeChange)
  window.removeEventListener('storage', onAdultStorageChange)
  window.removeEventListener('app:navigate-back', handleNavigateBack)
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
.folder-content { color: var(--text-primary); }
</style>
