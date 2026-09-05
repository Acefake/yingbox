<template>
  <div
    ref="leftPanel"
    :style="{
      width: 280 + 'px',
      minWidth: 280 + 'px',
    }"
    :class="[
      'flex flex-col flex-shrink-0 relative h-full border-r border-white/10',
    ]"
  >
    <!-- 顶部置顶操作区 -->
    <div class="flex-shrink-0 p-3 border-b border-white/10">
      <!-- 标题行 -->
      <div class="flex items-center justify-between px-1 mb-2">
        <h2 class="text-base font-semibold tracking-wide text-white">
          {{ mode === 'tv' ? '电视剧' : '电影' }}
        </h2>
        <span
          v-if="adultMode"
            class="text-xs font-bold px-1.5 py-0.5 rounded-md bg-red-600/70 text-red-100 tracking-wide"
        >18+</span>
        <span class="text-xs text-white/40">本地媒体库</span>
      </div>

      <!-- 扫描进度条（两种模式通用）-->
      <div v-if="dirLoading" class="mb-2 px-1">
        <div class="flex items-center gap-1.5 text-xs text-blue-300 mb-1">
          <span
            class="inline-block w-2 h-2 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"
          ></span>
          <span v-if="scanProgress?.active"
            >正在扫描... 已找到 {{ scanProgress.found }} 项</span
          >
          <span v-else>正在加载...</span>
        </div>
        <div class="h-0.5 bg-white bg-opacity-10 rounded overflow-hidden">
          <div
            class="h-full bg-blue-400 bg-opacity-60 rounded animate-pulse"
            style="width: 60%"
          ></div>
        </div>
      </div>

      <div class="space-y-2">
        <!-- 顶部操作区：文字风格，空间不足时自动换行 -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 pb-2">
          <button
            @click="$emit('addFolder')"
            :disabled="dirLoading"
            class="library-action-button"
          >
            + 添加
          </button>
          <button
            @click="$emit('refresh')"
            :disabled="dirLoading"
            class="library-action-button"
          >
            {{ dirLoading ? '刷新中...' : '刷新' }}
          </button>
          <span v-if="processedItems.length" class="ml-auto text-xs text-white/40">{{ processedItems.length }} 项</span>
        </div>

        <!-- 已添加目录列表（两种模式）-->
        <div
          v-if="directoryPaths?.length"
          class="space-y-1 max-h-16 overflow-y-auto"
        >
          <div
            v-for="(dir, i) in directoryPaths"
            :key="dir"
            class="flex items-center gap-1 px-2 py-1.5 bg-white bg-opacity-5 rounded-md text-xs text-gray-300 group"
          >
            <span class="flex-1 truncate" :title="dir">{{
              dir.split(/[/\\]/).pop()
            }}</span>
            <button
              @click="$emit('removeDirectory', i)"
              :aria-label="`移除目录 ${dir}`"
              class="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all flex-shrink-0"
            >
              ✕
            </button>
          </div>
        </div>

        <!-- 一键刮削所有未元数据项 -->
        <button
          v-if="mode !== 'tv' && unscrapedCount > 0"
          class="w-full min-h-9 px-3 rounded-lg text-xs font-semibold transition-all active:scale-95 bg-amber-600/70 hover:bg-amber-600/90 text-white"
          @click="$emit('scrapeAll')"
        >
          一键刮削 ({{ unscrapedCount }})
        </button>
      </div>
    </div>

    <!-- 可滚动文件列表 -->
    <div
      ref="listViewport"
      class="flex-1 overflow-y-auto p-2 custom-scrollbar primary-scrollbar"
      @scroll.passive="handleListScroll"
    >
      <div
        v-if="filteredItems.length === 0"
        class="p-4 text-gray-400 text-center text-sm"
      >
        {{ searchQuery ? '没有找到匹配内容' : '请先添加文件夹' }}
      </div>

      <template v-else-if="mode === 'tv'">
        <TVFileTreeItem
          v-for="(item, index) in filteredItems"
          :key="`tv-${item.path}`"
          :item="item"
          :index="index"
          :selected-index="selectedIndex"
          :selected-path="selectedPath"
          @select="
            (item: ProcessedItem, rootItem: ProcessedItem) =>
              $emit('selectItem', item, rootItem)
          "
          @preload="(item: ProcessedItem) => $emit('preload', item)"
          @auto-scrape="(item: ProcessedItem) => $emit('autoScrape', item)"
          @direct-scrape="(item: ProcessedItem) => $emit('directScrape', item)"
          @manual-scrape="(item: ProcessedItem) => $emit('manualScrape', item)"
        />
      </template>

      <template v-else>
        <div :style="{ height: `${movieListTopPadding}px` }" />
        <FileTreeItem
          v-for="entry in visibleMovieItems"
          :key="`movie-${entry.item.path}`"
          :item="entry.item"
          :index="entry.index"
          :selected-index="selectedIndex"
          :selected-path="selectedPath"
          @select="$emit('selectItem', entry.item, entry.index)"
          @show-search-modal="item => $emit('showSearchModal', item)"
          @manual-scrape="item => $emit('manualScrape', item)"
          @auto-scrape="item => $emit('autoScrape', item)"
          @direct-scrape="item => $emit('directScrape', item)"
          @preload="(item: ProcessedItem) => $emit('preload', item)"
          @local-scrape="(item: ProcessedItem) => $emit('localScrape', item)"
          @download-video="
            (item: ProcessedItem) => $emit('downloadVideo', item)
          "
          @fetch-meta="(item: ProcessedItem) => $emit('fetchMeta', item)"
          @play="(item: ProcessedItem) => $emit('play', item)"
          @delete-file="(item: ProcessedItem) => $emit('deleteFile', item)"
        />
        <div :style="{ height: `${movieListBottomPadding}px` }" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import FileTreeItem from '@/views/Movie/components/FileTreeItem.vue'
import TVFileTreeItem from '@/views/TV/components/TVFileTreeItem.vue'
import { ProcessedItem } from '@/types'
interface Props {
  processedItems: ProcessedItem[]
  selectedIndex: number
  dirLoading: boolean
  mode?: 'movie' | 'tv'
  directoryPaths?: string[]
  scanProgress?: { found: number; active: boolean }
  selectedPath?: string
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'movie',
})

const route = useRoute()
const searchQuery = ref('')
const adultMode = ref(localStorage.getItem('adultMode') === '1')
watch(
  () => route.query.q,
  query => { searchQuery.value = typeof query === 'string' ? query : '' },
  { immediate: true }
)
const syncAdultMode = () => { adultMode.value = localStorage.getItem('adultMode') === '1' }
const onAdultModeChange = () => syncAdultMode()
const onStorageChange = (event: StorageEvent) => {
  if (event.key === 'adultMode') syncAdultMode()
}

defineEmits<{
  /** 全量刷新 */
  refresh: []
  /** 添加文件夹 */
  addFolder: []
  /** 移除目录（TV模式）*/
  removeDirectory: [index: number]
  /** 清除缓存 */
  clearCache: []
  /** 选择项目 */
  /** TV模式: item=点击项, rootItem=所属show根; 电影模式: item=项, rootItem=项 */
  selectItem: [item: ProcessedItem, rootItem: ProcessedItem | number]
  /** 显示搜索模态框 */
  showSearchModal: [item: ProcessedItem]
  /** 手动刮削 */
  manualScrape: [item: ProcessedItem]
  /** 自动刮削 */
  autoScrape: [item: ProcessedItem]
  /** 直接刮削 */
  directScrape: [item: ProcessedItem]
  /** 鼠标悬停预加载 */
  preload: [item: ProcessedItem]
  /** 本地刮削 */
  localScrape: [item: ProcessedItem]
  /** 下载视频 */
  downloadVideo: [item: ProcessedItem]
  /** 预览元数据 */
  fetchMeta: [item: ProcessedItem]
  /** 播放 */
  play: [item: ProcessedItem]
  /** 删除文件 */
  deleteFile: [item: ProcessedItem]
  /** 一键刮削所有未元数据项 */
  scrapeAll: []
}>()

/**
 * 过滤后的项目列表
 * 使用节流优化搜索性能
 */
const filteredItems = computed(() => {
  if (!searchQuery.value.trim()) {
    return props.processedItems
  }

  const query = searchQuery.value.toLowerCase()
  const items = props.processedItems
  const len = items.length
  const result: ProcessedItem[] = []

  // 预分配结果数组，减少内存分配
  for (let i = 0; i < len; i++) {
    const item = items[i]
    const name = item.name.toLowerCase()

    // 快速路径：名称匹配
    if (name.includes(query)) {
      result.push(item)
      continue
    }

    // 路径匹配
    if (item.path.toLowerCase().includes(query)) {
      result.push(item)
      continue
    }

    // 文件夹内文件匹配
    if (item.type === 'folder' && item.files) {
      const files = item.files
      for (let j = 0; j < files.length; j++) {
        if (files[j].name.toLowerCase().includes(query)) {
          result.push(item)
          break
        }
      }
    }
  }

  return result
})

const listViewport = ref<HTMLElement | null>(null)
const listScrollTop = ref(0)
const listViewportHeight = ref(0)
const movieRowHeight = 31
const movieOverscan = 10
let listResizeObserver: ResizeObserver | undefined

const visibleMovieRange = computed(() => {
  const total = filteredItems.value.length
  const start = Math.max(
    0,
    Math.floor(listScrollTop.value / movieRowHeight) - movieOverscan
  )
  const visibleCount = Math.ceil(listViewportHeight.value / movieRowHeight)
  const end = Math.min(total, start + visibleCount + movieOverscan * 2)
  return { start, end, total }
})

const visibleMovieItems = computed(() => {
  const { start, end } = visibleMovieRange.value
  return filteredItems.value.slice(start, end).map((item, offset) => ({
    item,
    index: start + offset,
  }))
})

const movieListTopPadding = computed(
  () => visibleMovieRange.value.start * movieRowHeight
)
const movieListBottomPadding = computed(
  () =>
    (visibleMovieRange.value.total - visibleMovieRange.value.end) * movieRowHeight
)

const handleListScroll = (event: Event): void => {
  listScrollTop.value = (event.target as HTMLElement).scrollTop
}

const syncListViewport = (): void => {
  listViewportHeight.value = listViewport.value?.clientHeight || 0
}

onMounted(() => {
  window.addEventListener('adultModeChange', onAdultModeChange)
  window.addEventListener('storage', onStorageChange)
  void nextTick(() => {
    syncListViewport()
    if (!listViewport.value) return
    listResizeObserver = new ResizeObserver(syncListViewport)
    listResizeObserver.observe(listViewport.value)
  })
})

onBeforeUnmount(() => {
  listResizeObserver?.disconnect()
  window.removeEventListener('adultModeChange', onAdultModeChange)
  window.removeEventListener('storage', onStorageChange)
})

watch(filteredItems, () => {
  listScrollTop.value = 0
  listViewport.value?.scrollTo({ top: 0 })
})

/** 未刮削项数量（没有 NFO 文件的项） */
const unscrapedCount = computed(() => {
  const items = props.processedItems
  let count = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item.files || !item.files.some(f => f.name.toLowerCase().endsWith('.nfo'))) {
      count++
    }
  }
  return count
})
</script>

<style scoped>
.library-action-button {
  min-height: 30px;
  padding: 0 2px;
  border: 0;
  color: rgba(255, 255, 255, .62);
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: color .15s ease;
}

.library-action-button:hover:not(:disabled) { color: #fff; }
.library-action-button:disabled { cursor: not-allowed; opacity: .45; }

</style>
