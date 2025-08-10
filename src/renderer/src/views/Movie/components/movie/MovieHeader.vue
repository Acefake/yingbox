<template>
  <div class="movie-header">
    <div class="header-content">
      <!-- 电影标题和基本信息 -->
      <div class="movie-title-section">
        <h1 v-if="movieInfo?.title" class="movie-title">
          {{ movieInfo.title }}
          <span v-if="movieInfo.release_date" class="movie-year">
            ({{ new Date(movieInfo.release_date).getFullYear() }})
          </span>
        </h1>
        <div v-if="movieInfo?.tagline" class="movie-tagline">
          {{ movieInfo.tagline }}
        </div>
      </div>

      <!-- 操作按钮区域 -->
      <div class="action-buttons">
        <a-button 
          v-if="movieInfo?.imdb_id" 
          type="link" 
          :href="`https://www.imdb.com/title/${movieInfo.imdb_id}`" 
          target="_blank"
          class="imdb-link"
        >
          <template #icon>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22 12C22 17.5 17.5 22 12 22S2 17.5 2 12 6.5 2 12 2s10 4.5 10 10zM8.5 7.5H7v9h1.5V7.5zm2.5 0h1.5v9H11V7.5zm3.5 0H16v9h-1.5V7.5z"/>
            </svg>
          </template>
          IMDB
        </a-button>
        
        <a-button 
          v-if="movieInfo" 
          type="primary" 
          ghost
          @click="handleRefreshMetadata"
          :loading="isRefreshing"
        >
          <template #icon>
            <ReloadOutlined />
          </template>
          刷新信息
        </a-button>
        
        <a-button 
          type="primary"
          @click="handleManualScrape"
        >
          <template #icon>
            <SearchOutlined />
          </template>
          手动匹配
        </a-button>
      </div>
    </div>

    <!-- 电影评分和类型信息 -->
    <div v-if="movieInfo" class="movie-meta">
      <div class="meta-item" v-if="movieInfo.vote_average">
        <span class="meta-label">评分:</span>
        <span class="meta-value rating">
          <StarFilled class="star-icon" />
          {{ movieInfo.vote_average.toFixed(1) }}/10
        </span>
      </div>
      
      <div class="meta-item" v-if="movieInfo.runtime">
        <span class="meta-label">时长:</span>
        <span class="meta-value">{{ movieInfo.runtime }}分钟</span>
      </div>
      
      <div class="meta-item" v-if="movieInfo.genres?.length">
        <span class="meta-label">类型:</span>
        <span class="meta-value">
          {{ movieInfo.genres.map(g => g.name).join(', ') }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button as AButton } from 'ant-design-vue'
import { ReloadOutlined, SearchOutlined, StarFilled } from '@ant-design/icons-vue'
import type { MovieInfoType } from '@/type'

/**
 * MovieHeader 组件
 * 
 * 用于显示电影的头部信息，包括标题、年份、评分等基本信息
 * 以及相关的操作按钮（刷新、手动匹配、IMDB链接等）
 * 
 * @props movieInfo - 电影信息对象
 * @props isRefreshing - 是否正在刷新状态
 * @emits refresh-metadata - 刷新元数据事件
 * @emits manual-scrape - 手动匹配事件
 */

interface Props {
  /** 电影信息 */
  movieInfo?: MovieInfoType | null
  /** 是否正在刷新 */
  isRefreshing?: boolean
}

interface Emits {
  /** 刷新元数据 */
  'refresh-metadata': []
  /** 手动匹配 */
  'manual-scrape': []
}

const props = withDefaults(defineProps<Props>(), {
  movieInfo: null,
  isRefreshing: false
})

const emit = defineEmits<Emits>()

/**
 * 处理刷新元数据
 */
const handleRefreshMetadata = () => {
  emit('refresh-metadata')
}

/**
 * 处理手动匹配
 */
const handleManualScrape = () => {
  emit('manual-scrape')
}
</script>

<style scoped>
.movie-header {
  @apply bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6;
}

.header-content {
  @apply flex justify-between items-start mb-4;
}

.movie-title-section {
  @apply flex-1 mr-6;
}

.movie-title {
  @apply text-2xl font-bold text-gray-900 dark:text-white mb-2 flex items-center;
}

.movie-year {
  @apply text-gray-500 dark:text-gray-400 font-normal ml-2;
}

.movie-tagline {
  @apply text-gray-600 dark:text-gray-300 italic text-sm;
}

.action-buttons {
  @apply flex space-x-2 flex-shrink-0;
}

.imdb-link {
  @apply flex items-center space-x-1;
}

.movie-meta {
  @apply flex flex-wrap gap-6 text-sm;
}

.meta-item {
  @apply flex items-center space-x-2;
}

.meta-label {
  @apply text-gray-500 dark:text-gray-400 font-medium;
}

.meta-value {
  @apply text-gray-900 dark:text-white;
}

.rating {
  @apply flex items-center space-x-1;
}

.star-icon {
  @apply text-yellow-500;
}
</style>