<template>
  <div
    ref="leftPanel"
    :style="{
      width: 280 + 'px',
      minWidth: 280 + 'px',
      backgroundColor: 'rgba(17, 24, 39, 0.3)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
    }"
    :class="[
      'flex flex-col flex-shrink-0 relative rounded-xl glass-panel-floating shadow-2xl h-full',
      mode !== 'tv' ? 'border border-white border-opacity-20' : '',
    ]"
  >
    <!-- 顶部置顶操作区 -->
    <div class="flex-shrink-0 p-3 border-b border-white/10">
      <!-- 标题行 -->
      <div class="flex items-center justify-between px-1 mb-2">
        <h2 class="text-xs font-black uppercase tracking-widest text-gray-400">
          {{ mode === 'tv' ? '电视剧库' : '媒体库' }}
        </h2>
        <div class="flex items-center gap-2">
          <div
            v-if="processedItems.length"
            class="text-[10px] font-bold bg-white bg-opacity-10 px-2 py-0.5 rounded-full text-gray-400"
          >
            {{ processedItems.length }} {{ mode === 'tv' ? '剧集' : '项目' }}
          </div>
        </div>
      </div>

      <!-- 扫描进度条（两种模式通用）-->
      <div v-if="dirLoading" class="mb-2 px-1">
        <div class="flex items-center gap-1.5 text-[10px] text-blue-400 mb-1">
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

      <div class="space-y-1.5">
        <!-- 主操作按钮行 -->
        <div class="flex gap-1.5">
          <button
            @click="$emit('addFolder')"
            :disabled="dirLoading"
            class="flex-1 py-1.5 bg-blue-600 bg-opacity-60 hover:bg-opacity-80 text-white text-[11px] font-bold rounded-lg transition-all active:scale-95 disabled:opacity-50"
          >
            + 添加
          </button>
          <button
            @click="$emit('refresh')"
            :disabled="dirLoading"
            class="flex-1 py-1.5 bg-gray-700/60 hover:bg-gray-600/70 text-gray-100 text-[11px] font-bold rounded-lg transition-all active:scale-95 disabled:opacity-50"
          >
            {{ dirLoading ? '刷新中...' : '刷新' }}
          </button>
        </div>

        <!-- 搜索框（两种模式）-->
        <div class="relative">
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="
              mode === 'tv' ? '搜索电视剧...' : '搜索文件或文件夹...'
            "
            class="w-full py-1.5 pl-7 pr-6 rounded-lg bg-black bg-opacity-30 text-white placeholder-gray-500 border border-white border-opacity-10 focus:border-blue-500 focus:outline-none text-xs"
          />
          <svg
            class="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <button
            v-if="searchQuery"
            @click="searchQuery = ''"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
          >
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <!-- 已添加目录列表（两种模式）-->
        <div
          v-if="directoryPaths?.length"
          class="space-y-1 max-h-16 overflow-y-auto"
        >
          <div
            v-for="(dir, i) in directoryPaths"
            :key="dir"
            class="flex items-center gap-1 px-2 py-1 bg-white bg-opacity-5 rounded-md text-[10px] text-gray-400 group"
          >
            <span class="flex-1 truncate" :title="dir">{{
              dir.split(/[/\\]/).pop()
            }}</span>
            <button
              @click="$emit('removeDirectory', i)"
              class="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all flex-shrink-0"
            >
              ✕
            </button>
          </div>
        </div>

        <!-- 多选模式按钮 -->
        <button
          class="w-full py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95"
          :class="
            isMultiSelectMode
              ? 'bg-orange-500/70 hover:bg-orange-500/90 text-white'
              : 'bg-gray-700/60 hover:bg-gray-600/70 text-gray-100'
          "
          @click="$emit('toggleMultiSelect')"
        >
          {{ isMultiSelectMode ? '退出多选' : '多选模式' }}
        </button>

        <!-- 多选操作行 -->
        <div v-if="isMultiSelectMode" class="flex gap-1.5">
          <button
            class="flex-1 py-1.5 bg-blue-600 bg-opacity-60 hover:bg-opacity-80 text-white text-[11px] font-bold rounded-lg transition-all active:scale-95"
            @click="$emit('toggleSelectAll')"
          >
            {{
              (selectedItemsCount ?? 0) >= processedItems.length
                ? '取消全选'
                : '全选'
            }}
          </button>
          <button
            class="flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95"
            :class="
              (selectedItemsCount ?? 0) > 0
                ? 'bg-green-600 bg-opacity-70 hover:bg-opacity-90 text-white'
                : 'bg-gray-600 bg-opacity-40 text-gray-500 cursor-not-allowed'
            "
            :disabled="!selectedItemsCount || selectedItemsCount === 0"
            @click="$emit('addSelectedToQueue')"
          >
            批量刮削 ({{ selectedItemsCount ?? 0 }})
          </button>
        </div>
      </div>
    </div>

    <!-- 可滚动文件列表 -->
    <div class="flex-1 overflow-y-auto p-2 custom-scrollbar primary-scrollbar">
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
          :is-multi-select-mode="isMultiSelectMode"
          :is-selected="selectedItems?.has(item.path) || false"
          @select="
            (item: ProcessedItem, rootItem: ProcessedItem) =>
              $emit('selectItem', item, rootItem)
          "
          @preload="(item: ProcessedItem) => $emit('preload', item)"
          @toggle-selection="
            (item: ProcessedItem) => $emit('toggleSelection', item)
          "
          @auto-scrape="(item: ProcessedItem) => $emit('autoScrape', item)"
          @direct-scrape="(item: ProcessedItem) => $emit('directScrape', item)"
          @manual-scrape="(item: ProcessedItem) => $emit('manualScrape', item)"
        />
      </template>

      <template v-else>
        <FileTreeItem
          v-for="(item, index) in filteredItems"
          :key="`movie-${item.path}`"
          :item="item"
          :index="index"
          :selected-index="selectedIndex"
          :is-multi-select-mode="isMultiSelectMode"
          :is-selected="selectedItems?.has(item.path) || false"
          @select="$emit('selectItem', item, index)"
          @show-search-modal="item => $emit('showSearchModal', item)"
          @manual-scrape="item => $emit('manualScrape', item)"
          @auto-scrape="item => $emit('autoScrape', item)"
          @direct-scrape="item => $emit('directScrape', item)"
          @toggle-selection="
            (item: ProcessedItem) => $emit('toggleSelection', item)
          "
          @preload="(item: ProcessedItem) => $emit('preload', item)"
          @local-scrape="(item: ProcessedItem) => $emit('localScrape', item)"
          @download-video="
            (item: ProcessedItem) => $emit('downloadVideo', item)
          "
          @fetch-meta="(item: ProcessedItem) => $emit('fetchMeta', item)"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import FileTreeItem from '@/views/movie/components/FileTreeItem.vue'
import TVFileTreeItem from '@/views/tv/components/TVFileTreeItem.vue'
import { ProcessedItem } from '@/types'
interface Props {
  processedItems: ProcessedItem[]
  selectedIndex: number
  dirLoading: boolean
  isMultiSelectMode?: boolean
  selectedItems?: Set<string>
  selectedItemsCount?: number
  mode?: 'movie' | 'tv'
  directoryPaths?: string[]
  scanProgress?: { found: number; active: boolean }
  selectedPath?: string
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'movie',
})

// 搜索相关状态
const searchQuery = ref('')

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
  /** 切换多选模式 */
  toggleMultiSelect: []
  /** 切换全选 */
  toggleSelectAll: []
  /** 批量添加到队列 */
  addSelectedToQueue: []
  /** 切换选择 */
  toggleSelection: [item: ProcessedItem]
  /** 鼠标悬停预加载 */
  preload: [item: ProcessedItem]
  /** 本地刮削 */
  localScrape: [item: ProcessedItem]
  /** 下载视频 */
  downloadVideo: [item: ProcessedItem]
  /** 预览元数据 */
  fetchMeta: [item: ProcessedItem]
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
/* 使用全局 custom-scrollbar 样式 */
</style>
