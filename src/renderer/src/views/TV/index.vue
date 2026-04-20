<template>
  <div class="folder-content relative h-full text-white overflow-hidden">
    <!-- 左侧悬浮面板 -->
    <div class="absolute left-4 top-4 bottom-4 z-20 flex flex-col">
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
        @preload="handlePreload"
      />
    </div>

    <!-- 右侧内容区域 -->
    <div
      class="absolute inset-0 z-10"
      :style="{ paddingLeft: '272px' }"
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
              d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125Z"
            />
          </svg>
          <p class="text-2xl mb-2">欢迎使用本项目</p>
          <p class="text-sm">请先添加文件夹，点击[+添加]按钮添加文件夹</p>
        </div>
      </div>

      <div v-else class="p-6 h-full overflow-y-auto">
        <TVRightPanel
          :selected-item="selectedItem"
          :current-tv-show="selectedTVShow"
          :tv-info="tvInfo"
          :poster-url="posterUrl"
          :season-posters="seasonPosters"
          :episode-thumbs="episodeThumbs"
          @search-tv="searchTV"
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
import { ref, onMounted, inject, watch, onUnmounted, shallowRef } from 'vue'
import { useTVFileManagement } from './composables/use-tv-file-management'
import { useTVScraping } from './composables/use-tv-scraping'
import LeftPanel from '@/views/movie/components/LeftPanel.vue'
import TVRightPanel from './components/TVRightPanel.vue'
import MediaSearchModal from '@/components/MediaSearchModal.vue'
import type { MediaResult } from '@/components/MediaSearchModal.vue'
import type { ProcessedItem, TVShowInfoType } from '@/types'
import { message } from 'ant-design-vue'

interface AppLayoutMethods {
  setGlobalBackground: (imageUrl: string, overlayColor: string) => void
  clearGlobalBackground: () => void
}

const appLayoutMethods = inject('appLayoutMethods') as AppLayoutMethods | undefined

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
} = useTVFileManagement()

// 包装 readDirectory 以在添加目录后自动组织文件
const handleReadDirectory = async (): Promise<void> => {
  const previousLength = fileData.value.length
  await readDirectory()
  // 如果添加了新目录，检查是否需要自动组织文件
  if (fileData.value.length > previousLength) {
    const newItems = fileData.value.slice(previousLength)
    for (const item of newItems) {
      if (item.type === 'folder' && !item.isSeasonFolder) {
        // 检查是否没有季文件夹
        const hasSeasons = item.children?.some(child => child.isSeasonFolder)
        if (!hasSeasons) {
          await organizeFilesIntoSeasons(item.path)
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
  loadLocalTVInfo,
  loadEpisodeThumbs,
  preloadShowImages,
} = useTVScraping()

const selectedIndex = ref<number>(-1)
const tvInfo = shallowRef<TVShowInfoType | null>(null)
const loading = ref(false)

const selectedItem = ref<ProcessedItem | null>(null)
/** 总是指向 TV show 根节点（点击季时也保持为剧集根）*/
const selectedTVShow = ref<ProcessedItem | null>(null)
const posterUrl = ref('')
const fanartUrl = ref('')
const seasonPosters = shallowRef<Record<string, string>>({})
const episodeThumbs = shallowRef<Record<string, string>>({})

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
const selectItem = async (item: ProcessedItem, rootItem: ProcessedItem | number): Promise<void> => {
  const showRoot = typeof rootItem === 'object' ? rootItem : item
  const isSameShow = selectedTVShow.value?.path === showRoot.path

  // 批量更新状态
  selectedItem.value = item
  selectedTVShow.value = showRoot
  selectedIndex.value = -1

  // 切换到不同剧集：重载所有数据
  if (!isSameShow) {
    const local = await loadLocalTVInfo(showRoot)
    // 批量更新所有状态
    tvInfo.value = local.tvInfo
    posterUrl.value = local.posterDataUrl
    fanartUrl.value = local.fanartDataUrl
    seasonPosters.value = local.seasonPosters
    episodeThumbs.value = {}
  }

  // 点击季文件夹：懒加载该季的集缩略图
  if (item.isSeasonFolder) {
    episodeThumbs.value = await loadEpisodeThumbs(item)
  } else if (!isSameShow) {
    episodeThumbs.value = {}
  }
}

/** 第一步：搜索 → 弹窗展示结果列表 */
const searchTV = async (showItem: ProcessedItem, query?: string): Promise<void> => {
  try {
    loading.value = true
    const results = await searchTVInfo(query ? { ...showItem, name: query } : showItem)
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

/** 第二步：用户在弹窗中选择 → 拉取详情 → 刮削 */
const handlePreload = async (item: ProcessedItem): Promise<void> => {
  await preloadShowImages(item)
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
  try {
    const tvDetails = await getTVDetails(selected.id)
    if (tvDetails) {
      const seasons = await getAllSeasons(tvDetails.id)
      tvInfo.value = { ...convertToTVShowInfo(tvDetails), seasons }
      await scrapeTVShow(showItem, tvDetails, seasons)
      const local = await loadLocalTVInfo(showItem)
      if (local.posterDataUrl) posterUrl.value = local.posterDataUrl
      if (local.fanartDataUrl) fanartUrl.value = local.fanartDataUrl
      if (local.seasonPosters) seasonPosters.value = local.seasonPosters

      // 强制刷新 selectedItem 引用，使模板读取被 scrapeTVShow 修改后的 children
      if (selectedItem.value) {
        selectedItem.value = { ...selectedItem.value }
      }
    }
    searchModalVisible.value = false
  } catch (error) {
    console.error('刮削失败:', error)
    message.error('刮削失败')
  } finally {
    scrapingId.value = null
  }
}

// 监听 fanart 变化，设置全局背景
watch(
  fanartUrl,
  (newFanartUrl) => {
    if (appLayoutMethods) {
      if (newFanartUrl) {
        appLayoutMethods.setGlobalBackground(newFanartUrl, 'rgba(17, 24, 39, 0.2)')
      } else {
        appLayoutMethods.clearGlobalBackground()
      }
    }
  }
)

// 离开 TV 页面时清除全局背景
onUnmounted(() => {
  if (appLayoutMethods) {
    appLayoutMethods.clearGlobalBackground()
  }
})

onMounted(() => {
  if (fileData.value.length === 0) {
    loadFromCache()
  }
})
</script>

<style scoped>
.custom-scroll::-webkit-scrollbar {
  width: 6px;
}
.custom-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
}
.custom-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(59, 130, 246, 0.3);
}
</style>
