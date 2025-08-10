<template>
  <div class="tv-header">
    <div class="header-content">
      <!-- 电视剧标题和基本信息 -->
      <div class="tv-title-section">
        <h1 v-if="tvInfo?.name" class="tv-title">
          {{ tvInfo.name }}
          <span v-if="tvInfo.first_air_date" class="tv-year">
            ({{ new Date(tvInfo.first_air_date).getFullYear() }})
          </span>
        </h1>
        <div v-if="tvInfo?.tagline" class="tv-tagline">
          {{ tvInfo.tagline }}
        </div>
        <div v-if="tvInfo" class="tv-status">
          <span class="status-label">状态:</span>
          <span class="status-value" :class="getStatusClass(tvInfo.status)">
            {{ getStatusText(tvInfo.status) }}
          </span>
        </div>
      </div>

      <!-- 操作按钮区域 -->
      <div class="action-buttons">
        <a-button 
          v-if="tvInfo?.external_ids?.imdb_id" 
          type="link" 
          :href="`https://www.imdb.com/title/${tvInfo.external_ids.imdb_id}`" 
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
          v-if="tvInfo" 
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

    <!-- 电视剧评分和季集信息 -->
    <div v-if="tvInfo" class="tv-meta">
      <div class="meta-item" v-if="tvInfo.vote_average">
        <span class="meta-label">评分:</span>
        <span class="meta-value rating">
          <StarFilled class="star-icon" />
          {{ tvInfo.vote_average.toFixed(1) }}/10
        </span>
      </div>
      
      <div class="meta-item" v-if="tvInfo.number_of_seasons">
        <span class="meta-label">季数:</span>
        <span class="meta-value">{{ tvInfo.number_of_seasons }}季</span>
      </div>
      
      <div class="meta-item" v-if="tvInfo.number_of_episodes">
        <span class="meta-label">总集数:</span>
        <span class="meta-value">{{ tvInfo.number_of_episodes }}集</span>
      </div>
      
      <div class="meta-item" v-if="tvInfo.genres?.length">
        <span class="meta-label">类型:</span>
        <span class="meta-value">
          {{ tvInfo.genres.map(g => g.name).join(', ') }}
        </span>
      </div>
      
      <div class="meta-item" v-if="tvInfo.networks?.length">
        <span class="meta-label">播出平台:</span>
        <span class="meta-value">
          {{ tvInfo.networks.map(n => n.name).join(', ') }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button as AButton } from 'ant-design-vue'
import { ReloadOutlined, SearchOutlined, StarFilled } from '@ant-design/icons-vue'
import type { TVInfoType } from '@/type'

/**
 * TVHeader 组件
 * 
 * 用于显示电视剧的头部信息，包括标题、年份、评分、季集数等基本信息
 * 以及相关的操作按钮（刷新、手动匹配、IMDB链接等）
 * 
 * @props tvInfo - 电视剧信息对象
 * @props isRefreshing - 是否正在刷新状态
 * @emits refresh-metadata - 刷新元数据事件
 * @emits manual-scrape - 手动匹配事件
 */

interface Props {
  /** 电视剧信息 */
  tvInfo?: TVInfoType | null
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
  tvInfo: null,
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

/**
 * 获取状态对应的CSS类
 */
const getStatusClass = (status?: string) => {
  switch (status) {
    case 'Returning Series':
    case 'In Production':
      return 'status-active'
    case 'Ended':
    case 'Canceled':
      return 'status-ended'
    default:
      return 'status-unknown'
  }
}

/**
 * 获取状态的中文文本
 */
const getStatusText = (status?: string) => {
  switch (status) {
    case 'Returning Series':
      return '连载中'
    case 'Ended':
      return '已完结'
    case 'Canceled':
      return '已取消'
    case 'In Production':
      return '制作中'
    case 'Pilot':
      return '试播集'
    default:
      return status || '未知'
  }
}
</script>

<style scoped>
.tv-header {
  @apply bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6;
}

.header-content {
  @apply flex justify-between items-start mb-4;
}

.tv-title-section {
  @apply flex-1 mr-6;
}

.tv-title {
  @apply text-2xl font-bold text-gray-900 dark:text-white mb-2 flex items-center;
}

.tv-year {
  @apply text-gray-500 dark:text-gray-400 font-normal ml-2;
}

.tv-tagline {
  @apply text-gray-600 dark:text-gray-300 italic text-sm mb-2;
}

.tv-status {
  @apply flex items-center space-x-2 text-sm;
}

.status-label {
  @apply text-gray-500 dark:text-gray-400 font-medium;
}

.status-value {
  @apply px-2 py-1 rounded-full text-xs font-medium;
}

.status-active {
  @apply bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200;
}

.status-ended {
  @apply bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200;
}

.status-unknown {
  @apply bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200;
}

.action-buttons {
  @apply flex space-x-2 flex-shrink-0;
}

.imdb-link {
  @apply flex items-center space-x-1;
}

.tv-meta {
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