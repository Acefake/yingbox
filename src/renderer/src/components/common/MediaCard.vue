<template>
  <div 
    class="media-card"
    :class="{
      'selected': isSelected,
      'processing': isProcessing,
      'error': hasError,
      'completed': isCompleted
    }"
    @click="handleClick"
    @contextmenu="handleContextMenu"
  >
    <!-- 选择复选框 -->
    <div v-if="selectable" class="selection-checkbox">
      <input
        type="checkbox"
        :checked="isSelected"
        @click.stop="handleSelect"
        class="checkbox"
      />
    </div>
    
    <!-- 媒体海报 -->
    <div class="media-poster">
      <img 
        v-if="posterUrl"
        :src="posterUrl"
        :alt="mediaTitle"
        class="poster-image"
        @error="handlePosterError"
        @load="handlePosterLoad"
      />
      <div v-else class="poster-placeholder">
        <Icon name="image" class="placeholder-icon" />
      </div>
      
      <!-- 状态覆盖层 -->
      <div v-if="showStatusOverlay" class="status-overlay">
        <div v-if="isProcessing" class="status-processing">
          <Icon name="loader" class="animate-spin" />
          <span class="status-text">{{ $t('common.processing') }}</span>
        </div>
        
        <div v-else-if="hasError" class="status-error">
          <Icon name="alert-circle" />
          <span class="status-text">{{ $t('common.error') }}</span>
        </div>
        
        <div v-else-if="isCompleted" class="status-completed">
          <Icon name="check-circle" />
          <span class="status-text">{{ $t('common.completed') }}</span>
        </div>
      </div>
      
      <!-- 评分徽章 -->
      <div v-if="rating && showRating" class="rating-badge">
        <Icon name="star" class="rating-icon" />
        <span class="rating-text">{{ rating.toFixed(1) }}</span>
      </div>
      
      <!-- 媒体类型徽章 -->
      <div v-if="showMediaType" class="media-type-badge">
        <Icon :name="mediaType === 'movie' ? 'film' : 'tv'" />
        <span class="type-text">{{ mediaType === 'movie' ? $t('common.movie') : $t('common.tv') }}</span>
      </div>
    </div>
    
    <!-- 媒体信息 -->
    <div class="media-info">
      <h3 class="media-title" :title="mediaTitle">{{ mediaTitle }}</h3>
      
      <p v-if="originalTitle && originalTitle !== mediaTitle" class="original-title" :title="originalTitle">
        {{ originalTitle }}
      </p>
      
      <div class="media-meta">
        <span v-if="releaseYear" class="meta-year">{{ releaseYear }}</span>
        <span v-if="runtime" class="meta-runtime">{{ formatRuntime(runtime) }}</span>
        <span v-if="genres && genres.length > 0" class="meta-genres">
          {{ genres.slice(0, 2).map(g => g.name).join(', ') }}
          <span v-if="genres.length > 2" class="more-genres">+{{ genres.length - 2 }}</span>
        </span>
      </div>
      
      <!-- 电视剧特有信息 -->
      <div v-if="mediaType === 'tv' && (numberOfSeasons || numberOfEpisodes)" class="tv-info">
        <span v-if="numberOfSeasons" class="tv-seasons">
          {{ numberOfSeasons }} {{ $t('common.seasons') }}
        </span>
        <span v-if="numberOfEpisodes" class="tv-episodes">
          {{ numberOfEpisodes }} {{ $t('common.episodes') }}
        </span>
      </div>
      
      <!-- 文件信息 -->
      <div v-if="fileInfo" class="file-info">
        <div class="file-name" :title="fileInfo.name">
          <Icon name="file" class="file-icon" />
          <span class="file-text">{{ fileInfo.name }}</span>
        </div>
        
        <div class="file-meta">
          <span v-if="fileInfo.size" class="file-size">{{ formatFileSize(fileInfo.size) }}</span>
          <span v-if="fileInfo.extension" class="file-extension">{{ fileInfo.extension.toUpperCase() }}</span>
        </div>
      </div>
      
      <!-- 进度信息 -->
      <div v-if="progress !== undefined" class="progress-info">
        <div class="progress-bar">
          <div 
            class="progress-fill"
            :style="{ width: `${progress}%` }"
          ></div>
        </div>
        <span class="progress-text">{{ Math.round(progress) }}%</span>
      </div>
    </div>
    
    <!-- 操作按钮 -->
    <div v-if="showActions" class="media-actions">
      <button 
        v-if="!isCompleted"
        class="action-btn primary"
        @click.stop="handleScrape"
        :disabled="isProcessing"
        :title="$t('common.scrape')"
      >
        <Icon name="download" />
      </button>
      
      <button 
        class="action-btn secondary"
        @click.stop="handleRefresh"
        :disabled="isProcessing"
        :title="$t('common.refresh')"
      >
        <Icon name="refresh" :class="{ 'animate-spin': isProcessing }" />
      </button>
      
      <button 
        class="action-btn secondary"
        @click.stop="handleEdit"
        :title="$t('common.edit')"
      >
        <Icon name="edit" />
      </button>
      
      <button 
        class="action-btn danger"
        @click.stop="handleRemove"
        :title="$t('common.remove')"
      >
        <Icon name="trash" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { 
  MovieInfoType, 
  TVInfoType, 
  Genre, 
  FileItem 
} from '@/types'

/**
 * 媒体卡片组件
 * 
 * 用于显示电影或电视剧的卡片信息，支持选择、状态显示、操作按钮等功能
 * 可用于媒体库列表、搜索结果、队列管理等场景
 */

// Props 定义
interface Props {
  /** 媒体信息 */
  mediaInfo?: MovieInfoType | TVInfoType | null
  /** 媒体类型 */
  mediaType: 'movie' | 'tv'
  /** 海报URL */
  posterUrl?: string
  /** 是否可选择 */
  selectable?: boolean
  /** 是否已选择 */
  isSelected?: boolean
  /** 是否正在处理 */
  isProcessing?: boolean
  /** 是否有错误 */
  hasError?: boolean
  /** 是否已完成 */
  isCompleted?: boolean
  /** 是否显示状态覆盖层 */
  showStatusOverlay?: boolean
  /** 是否显示评分 */
  showRating?: boolean
  /** 是否显示媒体类型 */
  showMediaType?: boolean
  /** 是否显示操作按钮 */
  showActions?: boolean
  /** 文件信息 */
  fileInfo?: FileItem
  /** 进度百分比 */
  progress?: number
}

const props = withDefaults(defineProps<Props>(), {
  mediaInfo: null,
  posterUrl: '',
  selectable: false,
  isSelected: false,
  isProcessing: false,
  hasError: false,
  isCompleted: false,
  showStatusOverlay: true,
  showRating: true,
  showMediaType: false,
  showActions: true,
  fileInfo: undefined,
  progress: undefined
})

// Emits 定义
interface Emits {
  /** 点击事件 */
  click: []
  /** 选择事件 */
  select: [selected: boolean]
  /** 右键菜单事件 */
  contextMenu: [event: MouseEvent]
  /** 刮削事件 */
  scrape: []
  /** 刷新事件 */
  refresh: []
  /** 编辑事件 */
  edit: []
  /** 移除事件 */
  remove: []
}

const emit = defineEmits<Emits>()

// 计算属性
const mediaTitle = computed(() => {
  if (!props.mediaInfo) return props.fileInfo?.name || 'Unknown'
  return props.mediaType === 'movie' 
    ? (props.mediaInfo as MovieInfoType).title
    : (props.mediaInfo as TVInfoType).name
})

const originalTitle = computed(() => {
  if (!props.mediaInfo) return ''
  return props.mediaType === 'movie'
    ? (props.mediaInfo as MovieInfoType).original_title
    : (props.mediaInfo as TVInfoType).original_name
})

const releaseYear = computed(() => {
  if (!props.mediaInfo) return null
  const date = props.mediaType === 'movie'
    ? (props.mediaInfo as MovieInfoType).release_date
    : (props.mediaInfo as TVInfoType).first_air_date
  return date ? new Date(date).getFullYear() : null
})

const runtime = computed(() => {
  if (!props.mediaInfo) return null
  if (props.mediaType === 'movie') {
    return (props.mediaInfo as MovieInfoType).runtime
  } else {
    const episodeRuntime = (props.mediaInfo as TVInfoType).episode_run_time
    return episodeRuntime && episodeRuntime.length > 0 ? episodeRuntime[0] : null
  }
})

const rating = computed(() => props.mediaInfo?.vote_average)

const genres = computed(() => props.mediaInfo?.genres)

const numberOfSeasons = computed(() => {
  return props.mediaType === 'tv' ? (props.mediaInfo as TVInfoType)?.number_of_seasons : null
})

const numberOfEpisodes = computed(() => {
  return props.mediaType === 'tv' ? (props.mediaInfo as TVInfoType)?.number_of_episodes : null
})

// 方法
const formatRuntime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours > 0) {
    return `${hours}h ${mins}m`
  }
  return `${mins}m`
}

const formatFileSize = (bytes: number): string => {
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  if (bytes === 0) return '0 B'
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
}

// 事件处理函数
const handleClick = () => {
  emit('click')
}

const handleSelect = () => {
  emit('select', !props.isSelected)
}

const handleContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  emit('contextMenu', event)
}

const handleScrape = () => {
  emit('scrape')
}

const handleRefresh = () => {
  emit('refresh')
}

const handleEdit = () => {
  emit('edit')
}

const handleRemove = () => {
  emit('remove')
}

const handlePosterError = () => {
  // 处理海报加载错误
  console.warn('Failed to load poster image for:', mediaTitle.value)
}

const handlePosterLoad = () => {
  // 海报加载成功
}
</script>

<style scoped>
.media-card {
  @apply relative bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700
         hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden;
}

.media-card.selected {
  @apply ring-2 ring-blue-500 border-blue-500;
}

.media-card.processing {
  @apply border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20;
}

.media-card.error {
  @apply border-red-500 bg-red-50 dark:bg-red-900/20;
}

.media-card.completed {
  @apply border-green-500 bg-green-50 dark:bg-green-900/20;
}

.selection-checkbox {
  @apply absolute top-2 left-2 z-10;
}

.checkbox {
  @apply w-4 h-4 text-blue-600 bg-white border-gray-300 rounded
         focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800
         focus:ring-2 dark:bg-gray-700 dark:border-gray-600;
}

.media-poster {
  @apply relative aspect-[2/3] overflow-hidden;
}

.poster-image {
  @apply w-full h-full object-cover;
}

.poster-placeholder {
  @apply w-full h-full bg-gray-200 dark:bg-gray-700 
         flex items-center justify-center text-gray-400;
}

.placeholder-icon {
  @apply w-12 h-12;
}

.status-overlay {
  @apply absolute inset-0 bg-black bg-opacity-50 
         flex items-center justify-center text-white;
}

.status-processing,
.status-error,
.status-completed {
  @apply flex flex-col items-center gap-2;
}

.status-text {
  @apply text-sm font-medium;
}

.rating-badge {
  @apply absolute top-2 right-2 bg-black bg-opacity-70 text-white
         px-2 py-1 rounded-full flex items-center gap-1 text-xs;
}

.rating-icon {
  @apply w-3 h-3 text-yellow-400;
}

.media-type-badge {
  @apply absolute bottom-2 left-2 bg-blue-600 text-white
         px-2 py-1 rounded-full flex items-center gap-1 text-xs;
}

.type-text {
  @apply hidden sm:inline;
}

.media-info {
  @apply p-4;
}

.media-title {
  @apply text-lg font-semibold text-gray-900 dark:text-white
         truncate mb-1;
}

.original-title {
  @apply text-sm text-gray-600 dark:text-gray-400
         truncate mb-2;
}

.media-meta {
  @apply flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400 mb-2;
}

.meta-year {
  @apply font-medium;
}

.meta-genres {
  @apply truncate;
}

.more-genres {
  @apply text-gray-400;
}

.tv-info {
  @apply flex gap-3 text-xs text-gray-600 dark:text-gray-400 mb-2;
}

.file-info {
  @apply border-t border-gray-200 dark:border-gray-700 pt-2 mt-2;
}

.file-name {
  @apply flex items-center gap-2 mb-1;
}

.file-icon {
  @apply w-4 h-4 text-gray-400;
}

.file-text {
  @apply text-sm text-gray-700 dark:text-gray-300 truncate;
}

.file-meta {
  @apply flex gap-3 text-xs text-gray-500 dark:text-gray-400;
}

.progress-info {
  @apply mt-3;
}

.progress-bar {
  @apply w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-1;
}

.progress-fill {
  @apply bg-blue-600 h-2 rounded-full transition-all duration-300;
}

.progress-text {
  @apply text-xs text-gray-600 dark:text-gray-400;
}

.media-actions {
  @apply absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100
         transition-opacity duration-200;
}

.media-card:hover .media-actions {
  @apply opacity-100;
}

.action-btn {
  @apply w-8 h-8 rounded-full flex items-center justify-center
         transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed;
}

.action-btn.primary {
  @apply bg-blue-600 hover:bg-blue-700 text-white;
}

.action-btn.secondary {
  @apply bg-gray-600 hover:bg-gray-700 text-white;
}

.action-btn.danger {
  @apply bg-red-600 hover:bg-red-700 text-white;
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

/* 响应式设计 */
@media (max-width: 640px) {
  .media-info {
    @apply p-3;
  }
  
  .media-title {
    @apply text-base;
  }
  
  .media-actions {
    @apply opacity-100;
  }
}
</style>