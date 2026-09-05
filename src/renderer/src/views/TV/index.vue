<template>
  <div class="folder-content relative h-full text-white overflow-hidden">
    <!-- 左侧悬浮面板 -->
    <div class="absolute left-0 top-0 bottom-0 z-20 flex flex-col">
      <LeftPanel
        :processed-items="fileData"
        :selected-index="selectedIndex"
        :selected-path="selectedItem?.path"
        :dir-loading="dirLoading"
        :directory-paths="directoryPaths"
        :scan-progress="scanProgress"
        mode="tv"
        @refresh="refreshFiles"
        @add-folder="handleReadDirectory"
        @remove-directory="removeDirectory"
        @select-item="selectItem"
        @auto-scrape="searchTV"
        @direct-scrape="searchTV"
        @manual-scrape="searchTV"
      />
    </div>

    <!-- 右侧内容区域 -->
    <div class="absolute inset-0 z-10" :style="{ paddingLeft: '312px' }">
      <EmptyPlaceholder
        v-if="!selectedItem"
        icon-path="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125Z"
      />

      <div v-else class="primary-scroll p-6 h-full overflow-y-auto custom-scrollbar">
        <TVRightPanel
          :selected-item="selectedItem"
          :current-tv-show="selectedTVShow"
          :tv-info="tvInfo"
          :poster-url="posterUrl"
          :season-posters="seasonPosters"
          :episode-thumbs="episodeThumbs"
          @search-tv="searchTV"
          @scrape-season="handleScrapeSeason"
          @scrape-episode="handleScrapeEpisode"
        />
      </div>
    </div>

    <!-- 搜索结果弹窗 -->
    <MediaSearchModal
      type="tv"
      :results="searchResults"
      :loading-id="scrapingId"
      :visible="searchModalVisible"
      :initial-query="pendingScrapeShowItem?.name"
      @close="searchModalVisible = false"
      @scrape="handleScrapeChoice"
      @research="handleResearch"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, shallowRef } from 'vue'
import EmptyPlaceholder from '@/components/EmptyPlaceholder.vue'
import { useGlobalQueue } from '@/composables/use-global-queue'
import { useTVFileManagement } from './composables/use-tv-file-management'
import { useTVScraping } from './composables/use-tv-scraping'
import LeftPanel from '@/views/Movie/components/LeftPanel.vue'
import TVRightPanel from './components/TVRightPanel.vue'
import MediaSearchModal from '@/components/MediaSearchModal.vue'
import type { MediaResult } from '@/components/MediaSearchModal.vue'
import type { ProcessedItem, TVShowInfoType } from '@/types'
import { message } from 'ant-design-vue'

const {
  fileData,
  directoryPaths,
  scanProgress,
  dirLoading,
  readDirectory,
  removeDirectory,
  refreshFiles,
  loadFromCache,
  organizeFilesIntoSeasons,
  mergeSeriesSeasons,
} = useTVFileManagement()

// 包装 readDirectory 以在添加目录后自动组织文件
const handleReadDirectory = async (): Promise<void> => {
  // 先弹出目录选择对话框，拿到选中的路径后先做合并检测
  // readDirectory 内部会弹窗，合并需要知道父目录路径
  // 通过 readDirectory 完成后对比新增项的父目录来触发合并
  const previousLength = fileData.value.length
  await readDirectory()
  if (fileData.value.length > previousLength) {
    const newItems = fileData.value.slice(previousLength)
    // 收集新增项所在的父目录（去重）
    const parentDirs = new Set<string>()
    for (const item of newItems) {
      const sep = item.path.includes('\\') ? '\\' : '/'
      const parent = item.path.substring(0, item.path.lastIndexOf(sep))
      if (parent) parentDirs.add(parent)
    }
    // 对每个父目录检测并合并同名季文件夹
    let anyMerged = false
    for (const parentDir of Array.from(parentDirs)) {
      const merged = await mergeSeriesSeasons(parentDir)
      if (merged) anyMerged = true
    }
    // 合并后刷新；否则检查是否需要自动整理
    if (anyMerged) {
      await refreshFiles()
    } else {
      for (const item of newItems) {
        if (item.type === 'folder' && !item.isSeasonFolder) {
          const hasSeasons = item.children?.some(child => child.isSeasonFolder)
          if (!hasSeasons) {
            await organizeFilesIntoSeasons(item.path)
          }
        }
      }
    }
  }
}

const {
  searchTVInfo,
  getTVDetails,
  getAllSeasons,
  convertToTVShowInfo,
  scrapeTVShow,
  scrapeSeason,
  scrapeEpisode,
  loadLocalTVInfo,
  loadEpisodeThumbs,
} = useTVScraping()

const selectedIndex = ref<number>(-1)
const { addItem: addQueueItem, setProcessing: setQueueProcessing } = useGlobalQueue()

const tvInfo = shallowRef<TVShowInfoType | null>(null)
const loading = ref(false)

const selectedItem = ref<ProcessedItem | null>(null)
/** 总是指向 TV show 根节点（点击季时也保持为剧集根）*/
const selectedTVShow = ref<ProcessedItem | null>(null)
const posterUrl = ref('')
const fanartUrl = ref('')
const seasonPosters = shallowRef<Record<string, string>>({})
const episodeThumbs = shallowRef<Record<string, string>>({})
let selectionRequestId = 0

/** 搜索弹窗状态 */
const searchResults = ref<MediaResult[]>([])
const searchModalVisible = ref(false)
const scrapingId = ref<number | null>(null)
/** 正在刮削的 TV show 根（弹窗确认后用） */
const pendingScrapeShowItem = ref<ProcessedItem | null>(null)

/**
 * selectItem: 优化性能
 * - 同剧切季：跳过 show 级别重载
 * - 点季：懒加载该季的集缩略图
 * - 批量更新状态减少重渲染
 */
const selectItem = (
  item: ProcessedItem,
  rootItem: ProcessedItem | number
): void => {
  const showRoot = typeof rootItem === 'object' ? rootItem : item
  const isSameShow = selectedTVShow.value?.path === showRoot.path

  // 批量更新状态
  selectedItem.value = item
  selectedTVShow.value = showRoot
  selectedIndex.value = -1
  const requestId = ++selectionRequestId

  // 选中态先完成渲染，重资源读取放到后台；忽略快速切换产生的过期结果。
  if (!isSameShow) {
    tvInfo.value = null
    posterUrl.value = ''
    fanartUrl.value = ''
    seasonPosters.value = {}
    episodeThumbs.value = {}
    void loadLocalTVInfo(showRoot)
      .then(local => {
        if (requestId !== selectionRequestId) return
        tvInfo.value = local.tvInfo
        posterUrl.value = local.posterDataUrl
        fanartUrl.value = local.fanartDataUrl
        seasonPosters.value = local.seasonPosters
      })
      .catch(error => console.warn('读取本地电视剧信息失败:', error))
  }

  // 缩略图不再阻塞切换；只接受当前季的最新结果。
  if (item.isSeasonFolder) {
    void loadEpisodeThumbs(item)
      .then(thumbs => {
        if (
          requestId === selectionRequestId &&
          selectedItem.value?.path === item.path
        ) {
          episodeThumbs.value = thumbs
        }
      })
      .catch(error => console.warn('读取剧集缩略图失败:', error))
  } else if (!isSameShow) {
    episodeThumbs.value = {}
  }
}

/** 第一步：搜索 → 弹窗展示结果列表 */
const searchTV = async (
  showItem: ProcessedItem,
  query?: string
): Promise<void> => {
  try {
    loading.value = true
    const results = await searchTVInfo(
      query ? { ...showItem, name: query } : showItem
    )
    searchResults.value = results
    pendingScrapeShowItem.value = showItem
    searchModalVisible.value = true
  } catch (error) {
    console.error('搜索电视剧失败:', error)
    message.error('搜索电视剧失败')
  } finally {
    loading.value = false
  }
}

/** 刮削当前季 */
const handleScrapeSeason = async (
  seasonFolder: ProcessedItem
): Promise<void> => {
  const showRoot = selectedTVShow.value ?? selectedItem.value
  if (!showRoot) return
  const { seasonPosterDataUrl, thumbs } = await scrapeSeason(
    showRoot,
    seasonFolder
  )
  if (seasonPosterDataUrl) {
    seasonPosters.value = {
      ...seasonPosters.value,
      [seasonFolder.path]: seasonPosterDataUrl,
    }
  }
  if (Object.keys(thumbs).length) {
    episodeThumbs.value = { ...episodeThumbs.value, ...thumbs }
  }
  if (selectedItem.value) {
    selectedItem.value = { ...selectedItem.value }
  }
}

/** 刮削单集 */
const handleScrapeEpisode = async (
  seasonFolder: ProcessedItem,
  videoItem: ProcessedItem
): Promise<void> => {
  const showRoot = selectedTVShow.value ?? selectedItem.value
  if (!showRoot) return
  const thumbDataUrl = await scrapeEpisode(showRoot, seasonFolder, videoItem)
  if (thumbDataUrl) {
    episodeThumbs.value = {
      ...episodeThumbs.value,
      [videoItem.path]: thumbDataUrl,
    }
  }
  // 强制刷新 selectedItem 使 episodeList 重新渲染（文件可能已重命名）
  if (selectedItem.value) {
    selectedItem.value = { ...selectedItem.value }
  }
}

/** 用户手动修改搜索关键词重新搜索 */
const handleResearch = async (query: string): Promise<void> => {
  const showItem = pendingScrapeShowItem.value
  if (!showItem) return
  await searchTV(showItem, query)
}

const handleScrapeChoice = async (selected: MediaResult): Promise<void> => {
  const showItem = pendingScrapeShowItem.value
  if (!showItem) return
  scrapingId.value = selected.id

  addQueueItem(
    showItem.name,
    'tv',
    async (queueId: string) => {
      setQueueProcessing(queueId)
      try {
        const tvDetails = await getTVDetails(selected.id)
        if (!tvDetails) throw new Error('获取电视剧详情失败')
        if (tvDetails) {
          const seasons = await getAllSeasons(tvDetails.id)
          tvInfo.value = { ...convertToTVShowInfo(tvDetails), seasons }
          await scrapeTVShow(showItem, tvDetails, seasons)

          // 刮削完成后，检查父目录是否有同名系列季文件夹需要合并
          const sep = showItem.path.includes('\\') ? '\\' : '/'
          const parentDir = showItem.path.substring(
            0,
            showItem.path.lastIndexOf(sep)
          )
          if (parentDir) {
            const merged = await mergeSeriesSeasons(parentDir)
            if (merged) await refreshFiles()
          }

          const local = await loadLocalTVInfo(showItem)
          if (local.posterDataUrl) posterUrl.value = local.posterDataUrl
          if (local.fanartDataUrl) fanartUrl.value = local.fanartDataUrl
          if (local.seasonPosters) seasonPosters.value = local.seasonPosters

          // 强制刷新 selectedItem 引用，使模板读取被 scrapeTVShow 修改后的 children
          if (selectedItem.value) {
            selectedItem.value = { ...selectedItem.value }
          }
        }
      } finally {
        scrapingId.value = null
        searchModalVisible.value = false
      }
    }
  )
}

onMounted(() => {
  if (fileData.value.length === 0) {
    loadFromCache()
  }
})
</script>

<style scoped>
/* 使用全局 custom-scrollbar 样式 */
</style>
