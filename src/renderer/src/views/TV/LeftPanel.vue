<template>
  <div
    ref="leftPanel"
    :style="{
      width: leftPanelWidth + 'px',
      minWidth: minPanelWidth + 'px',
      backgroundColor: menuBackgroundColor,
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
    }"
    class="border border-white border-opacity-20 overflow-y-auto flex-shrink-0 relative rounded-xl glass-panel-floating shadow-2xl h-full"
  >
    <!-- 头部操作区域 -->
    <div class="flex gap-2 flex-col justify-between p-4 border-b border-gray-700">
      <h2 class="text-lg font-semibold text-white">媒体库</h2>

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
      <div class="mt-3">
        <div class="relative">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索文件或文件夹..."
            class="w-full p-2 pl-8 pr-8 rounded-lg bg-gray-800 bg-opacity-70 backdrop-blur-sm text-white placeholder-gray-400 border border-gray-600 focus:border-orange-500 focus:outline-none transition-all duration-200"
            @input="handleSearch"
          />
          <!-- 搜索图标 -->
          <svg
            class="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
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
            class="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 hover:text-white transition-colors"
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
      <div class="mt-3 space-y-2">
        <!-- 多选模式切换 -->
        <button
          class="w-full p-2 rounded-lg text-sm transition-all duration-200 backdrop-blur-sm shadow-lg"
          :class="
            isMultiSelectMode
              ? 'bg-orange-600 bg-opacity-70 hover:bg-opacity-90 text-white'
              : 'bg-gray-600 bg-opacity-70 hover:bg-opacity-90 text-white'
          "
          @click="$emit('toggleMultiSelect')"
        >
          <div class="flex items-center justify-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div v-if="isMultiSelectMode" class="space-y-2">
          <!-- 全选/取消全选 -->
          <button
            class="w-full p-2 rounded-lg bg-blue-600 bg-opacity-70 hover:bg-opacity-90 text-white text-sm transition-all duration-200 backdrop-blur-sm shadow-lg"
            @click="$emit('toggleSelectAll')"
          >
            <div class="flex items-center justify-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                ></path>
              </svg>
              {{ selectedItemsCount === processedItems.length ? '取消全选' : '全选' }}
            </div>
          </button>

          <!-- 批量添加到队列 -->
          <button
            class="w-full p-2 rounded-lg text-sm transition-all duration-200 backdrop-blur-sm shadow-lg"
            :class="
              selectedItemsCount > 0
                ? 'bg-green-600 bg-opacity-70 hover:bg-opacity-90 text-white'
                : 'bg-gray-600 bg-opacity-50 text-gray-400 cursor-not-allowed'
            "
            :disabled="selectedItemsCount === 0"
            @click="$emit('addSelectedToQueue')"
          >
            <div class="flex items-center justify-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    </div>

    <!-- 文件列表 -->
    <div v-if="filteredItems.length === 0" class="p-4 text-gray-400 text-center">
      <div class="text-sm">
        {{ searchQuery ? '没有找到匹配的文件或文件夹' : '请先添加文件夹或视频文件' }}
      </div>
    </div>

    <div v-else class="p-2">
      <FileTreeItem
        v-for="(item, index) in filteredItems"
        :key="item.path"
        :item="item"
        :index="index"
        :selected-index="selectedIndex"
        :menu-background-color="menuBackgroundColor"
        :is-multi-select-mode="isMultiSelectMode"
        :is-selected="selectedItems?.has(index) || false"
        @select="$emit('selectItem', item, index)"
        @refresh="targetPath => $emit('refresh', targetPath)"
        @show-search-modal="tvShows => $emit('search-t-v', tvShows)"
        @manual-scrape="item => $emit('manualScrape', item)"
        @auto-scrape="item => $emit('autoScrape', item)"
        @toggle-selection="$emit('toggleSelection', item, index)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ActionButtons from './ActionButtons.vue'
import FileTreeItem from './FileTreeItem.vue'
import type { Movie } from '@tdanks2000/tmdb-wrapper'

interface FileItem {
  name: string
  path: string
  size: number
  isDirectory: boolean
  isFile: boolean
}

interface ProcessedItem {
  name: string
  path: string
  type: 'folder' | 'video'
  size?: number
  fileCount?: number
  files?: FileItem[]
}

interface Props {
  processedItems: ProcessedItem[]
  selectedIndex: number
  leftPanelWidth: number
  minPanelWidth: number
  menuBackgroundColor: string
  dirLoading: boolean
  scrapeQueueCount?: number
  isProcessingQueue?: boolean
  isMultiSelectMode?: boolean
  selectedItems?: Set<number>
  selectedItemsCount?: number
}

const props = defineProps<Props>()

defineEmits<{
  refresh: [targetPath?: string]
  addFolder: []
  clearCache: []
  selectItem: [item: ProcessedItem, index: number]
  'search-t-v': [query: string]
  manualScrape: [item: ProcessedItem]
  autoScrape: [item: ProcessedItem]
  showQueue: []
  toggleMultiSelect: []
  toggleSelectAll: []
  addSelectedToQueue: []
  toggleSelection: [item: ProcessedItem, index: number]
}>()

const leftPanel = ref<HTMLElement | null>(null)

// 搜索相关状态
const searchQuery = ref('')

/**
 * 处理搜索输入
 */
const handleSearch = (): void => {
  // 搜索逻辑在计算属性中处理
}

/**
 * 清除搜索
 */
const clearSearch = (): void => {
  searchQuery.value = ''
}

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
