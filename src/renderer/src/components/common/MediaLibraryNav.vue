<template>
  <div class="media-library-nav">
    <!-- 顶部操作栏 -->
    <div class="nav-header">
      <div class="nav-title">
        <h2>{{ title }}</h2>
        <span class="nav-subtitle">{{ subtitle }}</span>
      </div>
      
      <div class="nav-actions">
        <!-- 刷新按钮 -->
        <button 
          class="action-btn refresh-btn"
          :disabled="isLoading"
          @click="handleRefresh"
          :title="$t('common.refresh')"
        >
          <Icon name="refresh" :class="{ 'animate-spin': isLoading }" />
        </button>
        
        <!-- 设置按钮 -->
        <button 
          class="action-btn settings-btn"
          @click="handleSettings"
          :title="$t('common.settings')"
        >
          <Icon name="settings" />
        </button>
        
        <!-- 帮助按钮 -->
        <button 
          class="action-btn help-btn"
          @click="handleHelp"
          :title="$t('common.help')"
        >
          <Icon name="help" />
        </button>
      </div>
    </div>
    
    <!-- 搜索栏 -->
    <div class="nav-search" v-if="showSearch">
      <div class="search-input-wrapper">
        <Icon name="search" class="search-icon" />
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          :placeholder="searchPlaceholder"
          @input="handleSearchInput"
          @keyup.enter="handleSearchEnter"
        />
        <button 
          v-if="searchQuery"
          class="clear-search-btn"
          @click="handleClearSearch"
          :title="$t('common.clear')"
        >
          <Icon name="close" />
        </button>
      </div>
      
      <!-- 搜索过滤器 -->
      <div class="search-filters" v-if="showFilters">
        <select 
          v-model="selectedYear"
          class="filter-select"
          @change="handleFilterChange"
        >
          <option value="">{{ $t('common.allYears') }}</option>
          <option 
            v-for="year in availableYears"
            :key="year"
            :value="year"
          >
            {{ year }}
          </option>
        </select>
        
        <select 
          v-model="selectedGenre"
          class="filter-select"
          @change="handleFilterChange"
        >
          <option value="">{{ $t('common.allGenres') }}</option>
          <option 
            v-for="genre in availableGenres"
            :key="genre.id"
            :value="genre.id"
          >
            {{ genre.name }}
          </option>
        </select>
        
        <select 
          v-model="sortBy"
          class="filter-select"
          @change="handleSortChange"
        >
          <option value="name">{{ $t('common.sortByName') }}</option>
          <option value="date">{{ $t('common.sortByDate') }}</option>
          <option value="rating">{{ $t('common.sortByRating') }}</option>
          <option value="size">{{ $t('common.sortBySize') }}</option>
        </select>
        
        <button 
          class="sort-direction-btn"
          @click="toggleSortDirection"
          :title="sortDirection === 'asc' ? $t('common.ascending') : $t('common.descending')"
        >
          <Icon :name="sortDirection === 'asc' ? 'sort-asc' : 'sort-desc'" />
        </button>
      </div>
    </div>
    
    <!-- 统计信息 -->
    <div class="nav-stats" v-if="showStats">
      <div class="stat-item">
        <span class="stat-label">{{ $t('common.total') }}:</span>
        <span class="stat-value">{{ stats.total }}</span>
      </div>
      
      <div class="stat-item">
        <span class="stat-label">{{ $t('common.withPoster') }}:</span>
        <span class="stat-value">{{ stats.withPoster }}</span>
      </div>
      
      <div class="stat-item">
        <span class="stat-label">{{ $t('common.withoutPoster') }}:</span>
        <span class="stat-value">{{ stats.withoutPoster }}</span>
      </div>
      
      <div class="stat-item">
        <span class="stat-label">{{ $t('common.selected') }}:</span>
        <span class="stat-value">{{ stats.selected }}</span>
      </div>
    </div>
    
    <!-- 批量操作栏 -->
    <div class="nav-batch-actions" v-if="showBatchActions && stats.selected > 0">
      <div class="batch-info">
        <span>{{ $t('common.selectedItems', { count: stats.selected }) }}</span>
      </div>
      
      <div class="batch-buttons">
        <button 
          class="batch-btn scrape-btn"
          @click="handleBatchScrape"
          :disabled="isProcessing"
        >
          <Icon name="download" />
          {{ $t('common.batchScrape') }}
        </button>
        
        <button 
          class="batch-btn refresh-btn"
          @click="handleBatchRefresh"
          :disabled="isProcessing"
        >
          <Icon name="refresh" />
          {{ $t('common.batchRefresh') }}
        </button>
        
        <button 
          class="batch-btn clear-btn"
          @click="handleClearSelection"
        >
          <Icon name="close" />
          {{ $t('common.clearSelection') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Genre } from '@/types'

/**
 * 媒体库导航组件
 * 
 * 提供搜索、过滤、排序、统计和批量操作功能
 * 可用于电影和电视剧模块的通用导航
 */

// Props 定义
interface Props {
  /** 导航标题 */
  title: string
  /** 导航副标题 */
  subtitle?: string
  /** 搜索占位符文本 */
  searchPlaceholder?: string
  /** 是否显示搜索功能 */
  showSearch?: boolean
  /** 是否显示过滤器 */
  showFilters?: boolean
  /** 是否显示统计信息 */
  showStats?: boolean
  /** 是否显示批量操作 */
  showBatchActions?: boolean
  /** 是否正在加载 */
  isLoading?: boolean
  /** 是否正在处理 */
  isProcessing?: boolean
  /** 可用年份列表 */
  availableYears?: number[]
  /** 可用类型列表 */
  availableGenres?: Genre[]
  /** 统计信息 */
  stats?: {
    total: number
    withPoster: number
    withoutPoster: number
    selected: number
  }
}

const props = withDefaults(defineProps<Props>(), {
  subtitle: '',
  searchPlaceholder: '搜索...',
  showSearch: true,
  showFilters: true,
  showStats: true,
  showBatchActions: true,
  isLoading: false,
  isProcessing: false,
  availableYears: () => [],
  availableGenres: () => [],
  stats: () => ({
    total: 0,
    withPoster: 0,
    withoutPoster: 0,
    selected: 0
  })
})

// Emits 定义
interface Emits {
  /** 刷新事件 */
  refresh: []
  /** 设置事件 */
  settings: []
  /** 帮助事件 */
  help: []
  /** 搜索事件 */
  search: [query: string]
  /** 过滤器变化事件 */
  filterChange: [filters: {
    year?: string
    genre?: string
  }]
  /** 排序变化事件 */
  sortChange: [sort: {
    by: string
    direction: 'asc' | 'desc'
  }]
  /** 批量刮削事件 */
  batchScrape: []
  /** 批量刷新事件 */
  batchRefresh: []
  /** 清除选择事件 */
  clearSelection: []
}

const emit = defineEmits<Emits>()

// 响应式数据
const searchQuery = ref('')
const selectedYear = ref('')
const selectedGenre = ref('')
const sortBy = ref('name')
const sortDirection = ref<'asc' | 'desc'>('asc')

// 计算属性
const currentFilters = computed(() => ({
  year: selectedYear.value,
  genre: selectedGenre.value
}))

const currentSort = computed(() => ({
  by: sortBy.value,
  direction: sortDirection.value
}))

// 事件处理函数
const handleRefresh = () => {
  emit('refresh')
}

const handleSettings = () => {
  emit('settings')
}

const handleHelp = () => {
  emit('help')
}

const handleSearchInput = () => {
  emit('search', searchQuery.value)
}

const handleSearchEnter = () => {
  emit('search', searchQuery.value)
}

const handleClearSearch = () => {
  searchQuery.value = ''
  emit('search', '')
}

const handleFilterChange = () => {
  emit('filterChange', currentFilters.value)
}

const handleSortChange = () => {
  emit('sortChange', currentSort.value)
}

const toggleSortDirection = () => {
  sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  emit('sortChange', currentSort.value)
}

const handleBatchScrape = () => {
  emit('batchScrape')
}

const handleBatchRefresh = () => {
  emit('batchRefresh')
}

const handleClearSelection = () => {
  emit('clearSelection')
}

// 监听器
watch(searchQuery, (newValue) => {
  // 防抖搜索
  if (searchTimeout.value) {
    clearTimeout(searchTimeout.value)
  }
  searchTimeout.value = setTimeout(() => {
    emit('search', newValue)
  }, 300)
})

const searchTimeout = ref<NodeJS.Timeout | null>(null)
</script>

<style scoped>
.media-library-nav {
  @apply bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700;
}

.nav-header {
  @apply flex items-center justify-between p-4;
}

.nav-title h2 {
  @apply text-xl font-semibold text-gray-900 dark:text-white;
}

.nav-subtitle {
  @apply text-sm text-gray-500 dark:text-gray-400 ml-2;
}

.nav-actions {
  @apply flex items-center space-x-2;
}

.action-btn {
  @apply p-2 rounded-lg border border-gray-300 dark:border-gray-600 
         bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300
         hover:bg-gray-50 dark:hover:bg-gray-600 
         disabled:opacity-50 disabled:cursor-not-allowed
         transition-colors duration-200;
}

.nav-search {
  @apply px-4 pb-4;
}

.search-input-wrapper {
  @apply relative flex items-center;
}

.search-icon {
  @apply absolute left-3 w-4 h-4 text-gray-400;
}

.search-input {
  @apply w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600
         rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
         placeholder-gray-500 dark:placeholder-gray-400
         focus:ring-2 focus:ring-blue-500 focus:border-transparent;
}

.clear-search-btn {
  @apply absolute right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300;
}

.search-filters {
  @apply flex items-center space-x-3 mt-3;
}

.filter-select {
  @apply px-3 py-2 border border-gray-300 dark:border-gray-600
         rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
         focus:ring-2 focus:ring-blue-500 focus:border-transparent;
}

.sort-direction-btn {
  @apply p-2 border border-gray-300 dark:border-gray-600
         rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300
         hover:bg-gray-50 dark:hover:bg-gray-600;
}

.nav-stats {
  @apply flex items-center space-x-6 px-4 py-2 bg-gray-50 dark:bg-gray-700/50;
}

.stat-item {
  @apply flex items-center space-x-1;
}

.stat-label {
  @apply text-sm text-gray-600 dark:text-gray-400;
}

.stat-value {
  @apply text-sm font-medium text-gray-900 dark:text-white;
}

.nav-batch-actions {
  @apply flex items-center justify-between px-4 py-3 bg-blue-50 dark:bg-blue-900/20
         border-t border-blue-200 dark:border-blue-800;
}

.batch-info {
  @apply text-sm font-medium text-blue-900 dark:text-blue-100;
}

.batch-buttons {
  @apply flex items-center space-x-2;
}

.batch-btn {
  @apply flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm font-medium
         transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed;
}

.batch-btn.scrape-btn {
  @apply bg-green-600 hover:bg-green-700 text-white;
}

.batch-btn.refresh-btn {
  @apply bg-blue-600 hover:bg-blue-700 text-white;
}

.batch-btn.clear-btn {
  @apply bg-gray-600 hover:bg-gray-700 text-white;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>