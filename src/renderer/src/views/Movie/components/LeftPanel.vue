<template>
  <div
    ref="leftPanel"
    :style="{
      width: 240 + 'px',
      minWidth: 240 + 'px',
      backgroundColor: 'rgba(17, 24, 39, 0.3)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
    }"
    :class="[
      'overflow-y-auto flex-shrink-0 relative rounded-xl glass-panel-floating shadow-2xl h-full left-panel-scroll',
      mode !== 'tv' ? 'border border-white border-opacity-20' : ''
    ]"
  >
    <div
      class="flex gap-2 flex-col justify-between p-3 border-b border-white border-opacity-5"
    >
      <div class="flex items-center justify-between px-1">
        <h2 class="text-xs font-black uppercase tracking-widest text-gray-400">
          {{ mode === 'tv' ? '电视剧库' : '媒体库' }}
        </h2>
        <div v-if="processedItems.length" class="text-[10px] font-bold bg-white bg-opacity-10 px-2 py-0.5 rounded-full text-gray-400">
          {{ processedItems.length }} {{ mode === 'tv' ? '剧集' : '项目' }}
        </div>
      </div>

      <!-- 扫描进度条（两种模式通用）-->
      <div v-if="dirLoading" class="mt-2 px-1">
        <div class="flex items-center gap-1.5 text-[10px] text-blue-400 mb-1">
          <span class="inline-block w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></span>
          <span v-if="scanProgress?.active && scanProgress.found > 0">正在扫描... 已找到 {{ scanProgress.found }} 项</span>
          <span v-else>正在加载...</span>
        </div>
        <div class="h-0.5 bg-white bg-opacity-10 rounded overflow-hidden">
          <div class="h-full bg-blue-400 bg-opacity-60 rounded animate-pulse" style="width:60%"></div>
        </div>
      </div>

      <!-- 电视剧模式：简化按钮组 -->
      <div v-if="mode === 'tv'" class="space-y-2 mt-2">
        <div class="flex gap-2">
          <button
            @click="$emit('addFolder')"
            class="flex-1 p-2 bg-blue-600 bg-opacity-60 hover:bg-opacity-80 text-white text-[11px] font-bold rounded-lg transition-all backdrop-blur-md shadow-lg active:scale-95"
          >
            + 添加目录
          </button>
          <button
            @click="$emit('refresh')"
            :disabled="dirLoading"
            class="flex-1 p-2 bg-white bg-opacity-10 hover:bg-opacity-20 text-white text-[11px] font-bold rounded-lg transition-all active:scale-95 disabled:opacity-50"
          >
            <span v-if="!dirLoading">刷新</span>
            <span v-else>刷新中...</span>
          </button>
        </div>
        <!-- 已添加的目录列表 -->
        <div v-if="directoryPaths && directoryPaths.length" class="space-y-1">
          <div
            v-for="(dir, i) in directoryPaths"
            :key="dir"
            class="flex items-center gap-1 px-2 py-1 bg-white bg-opacity-5 rounded-md text-[10px] text-gray-400 group"
          >
            <span class="flex-1 truncate" :title="dir">{{ dir.split(/[/\\]/).pop() }}</span>
            <button
              @click="$emit('removeDirectory', i)"
              class="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all ml-1 flex-shrink-0"
              title="移除此目录"
            >✕</button>
          </div>
        </div>
      </div>

      <!-- 电影模式：完整功能 -->
      <template v-else>
        <ActionButtons
          :dir-loading="dirLoading"
          :scrape-queue-count="scrapeQueueCount"
          :is-processing-queue="isProcessingQueue"
          @refresh="$emit('refresh')"
          @add-folder="$emit('addFolder')"
          @clear-cache="$emit('clearCache')"
          @show-queue="$emit('showQueue')"
        />

        <!-- 搜索框 -->
        <div class="mt-2">
          <div class="relative">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索文件或文件夹..."
              class="w-full p-1.5 pl-7 pr-7 rounded-md bg-gray-800 bg-opacity-70 backdrop-blur-sm text-white placeholder-gray-400 border border-gray-600 focus:border-orange-500 focus:outline-none transition-all duration-200 text-xs"
              @input="handleSearch"
            />
            <!-- 搜索图标 -->
            <svg
              class="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              ></path>
            </svg>
            <!-- 清除按钮 -->
            <button
              v-if="searchQuery"
              class="absolute right-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400 hover:text-white transition-colors"
              @click="clearSearch"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                ></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- 多选控制区域 -->
        <div class="mt-2 space-y-1">
          <!-- 多选模式切换 -->
          <button
            class="w-full p-1.5 rounded-md text-xs transition-all duration-200 backdrop-blur-sm shadow-lg"
            :class="
              isMultiSelectMode
                ? 'bg-orange-600 bg-opacity-70 hover:bg-opacity-90 text-white'
                : 'bg-gray-600 bg-opacity-70 hover:bg-opacity-90 text-white'
            "
            @click="$emit('toggleMultiSelect')"
          >
            <div class="flex items-center justify-center gap-1.5">
              <svg
                class="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                ></path>
              </svg>
              {{ isMultiSelectMode ? '退出多选' : '多选模式' }}
            </div>
          </button>

          <!-- 多选操作按钮组 -->
          <div v-if="isMultiSelectMode" class="space-y-1">
            <!-- 全选/取消全选 -->
            <button
              class="w-full p-1.5 rounded-md bg-blue-600 bg-opacity-70 hover:bg-opacity-90 text-white text-xs transition-all duration-200 backdrop-blur-sm shadow-lg"
              @click="$emit('toggleSelectAll')"
            >
              <div class="flex items-center justify-center gap-1.5">
                <svg
                  class="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  ></path>
                </svg>
                {{
                  selectedItemsCount === processedItems.length
                    ? '取消全选'
                    : '全选'
                }}
              </div>
            </button>

            <!-- 批量添加到队列 -->
            <button
              class="w-full p-1.5 rounded-md text-xs transition-all duration-200 backdrop-blur-sm shadow-lg"
              :class="
                selectedItemsCount > 0
                  ? 'bg-green-600 bg-opacity-70 hover:bg-opacity-90 text-white'
                  : 'bg-gray-600 bg-opacity-50 text-gray-400 cursor-not-allowed'
              "
              :disabled="selectedItemsCount === 0"
              @click="$emit('addSelectedToQueue')"
            >
              <div class="flex items-center justify-center gap-1.5">
                <svg
                  class="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  ></path>
                </svg>
                批量加入队列 ({{ selectedItemsCount }})
              </div>
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- 文件列表 -->
    <div
      v-if="filteredItems.length === 0"
      class="p-4 text-gray-400 text-center"
    >
      <div class="text-sm">
        {{
          searchQuery
            ? '没有找到匹配的文件或文件夹'
            : '请先添加文件夹或视频文件'
        }}
      </div>
    </div>

    <div v-else class="p-2">
      <!-- 电视剧模式使用 TVFileTreeItem -->
      <template v-if="mode === 'tv'">
        <TVFileTreeItem
          v-for="(item, index) in filteredItems"
          :key="`tv-${item.path}`"
          :item="item"
          :index="index"
          :selected-index="selectedIndex"
          :selected-path="selectedPath"
          @select="(item: ProcessedItem, rootItem: ProcessedItem) => $emit('selectItem', item, rootItem)"
          @preload="(item: ProcessedItem) => $emit('preload', item)"
        />
      </template>
      <!-- 电影模式使用 FileTreeItem -->
      <template v-else>
        <FileTreeItem
          v-for="(item, index) in filteredItems"
          :key="`movie-${item.path}`"
          :item="item"
          :index="index"
          :selected-index="selectedIndex"
          :is-multi-select-mode="isMultiSelectMode"
          :is-selected="selectedItems?.has(index) || false"
          @select="$emit('selectItem', item, index)"
          @refresh="targetPath => $emit('refresh', targetPath)"
          @show-search-modal="item => $emit('showSearchModal', item)"
          @manual-scrape="item => $emit('manualScrape', item)"
          @auto-scrape="item => $emit('autoScrape', item)"
          @direct-scrape="item => $emit('directScrape', item)"
          @toggle-selection="$emit('toggleSelection', item, index)"
          @preload="(item: ProcessedItem) => $emit('preload', item)"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ActionButtons from '@/components/ActionButtons.vue'
import FileTreeItem from '@/views/movie/components/FileTreeItem.vue'
import TVFileTreeItem from '@/views/tv/components/TVFileTreeItem.vue'
import { ProcessedItem } from '@/types'
interface Props {
  processedItems: ProcessedItem[]
  selectedIndex: number
  dirLoading: boolean
  scrapeQueueCount?: number
  isProcessingQueue?: boolean
  isMultiSelectMode?: boolean
  selectedItems?: Set<number>
  selectedItemsCount?: number
  mode?: 'movie' | 'tv'
  directoryPaths?: string[]
  scanProgress?: { found: number; active: boolean }
  selectedPath?: string
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'movie'
})

// 搜索相关状态
const searchQuery = ref('')

/**
 * 搜索关键词
 */
const handleSearch = (e: Event): void => {
  const query = (e.target as HTMLInputElement).value
  searchQuery.value = query
}

/**
 * 清除搜索
 */
const clearSearch = (): void => {
  searchQuery.value = ''
}

const emit = defineEmits<{
  /** 刷新指定路径的文件树 */
  refresh: [targetPath?: string]
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
  /** 显示队列 */
  showQueue: []
  /** 切换多选模式 */
  toggleMultiSelect: []
  /** 切换全选 */
  toggleSelectAll: []
  /** 批量添加到队列 */
  addSelectedToQueue: []
  /** 切换选择 */
  toggleSelection: [item: ProcessedItem, index: number]
  /** 鼠标悬停预加载 */
  preload: [item: ProcessedItem]
}>()

/**
 * 过滤后的项目列表
 * 根据搜索关键词过滤processedItems
 */
const filteredItems = computed(() => {
  if (!searchQuery.value.trim()) {
    return props.processedItems
  }

  const query = searchQuery.value.toLowerCase().trim()

  return props.processedItems.filter(item => {
    // 按名称搜索
    if (item.name.toLowerCase().includes(query)) {
      return true
    }

    // 按路径搜索
    if (item.path.toLowerCase().includes(query)) {
      return true
    }

    // 如果是文件夹，搜索其中的文件
    if (item.type === 'folder' && item.files) {
      return item.files.some(file => file.name.toLowerCase().includes(query))
    }

    return false
  })
})
</script>

<style scoped>
.left-panel-scroll::-webkit-scrollbar {
  width: 6px;
}

.left-panel-scroll::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.left-panel-scroll::-webkit-scrollbar-thumb {
  background: rgba(59, 130, 246, 0.5);
  border-radius: 3px;
  transition: background 0.2s;
}

.left-panel-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(59, 130, 246, 0.7);
}

.left-panel-scroll::-webkit-scrollbar-thumb:active {
  background: rgba(59, 130, 246, 0.9);
}

/* Firefox */
.left-panel-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(59, 130, 246, 0.5) rgba(255, 255, 255, 0.05);
}
</style>
