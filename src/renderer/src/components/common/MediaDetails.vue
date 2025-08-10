<template>
  <div class="media-details" v-if="mediaInfo">
    <!-- 媒体头部信息 -->
    <div class="media-header">
      <div class="media-poster">
        <img 
          v-if="posterUrl"
          :src="posterUrl"
          :alt="mediaTitle"
          class="poster-image"
          @error="handlePosterError"
        />
        <div v-else class="poster-placeholder">
          <Icon name="image" class="placeholder-icon" />
          <span class="placeholder-text">{{ $t('common.noPoster') }}</span>
        </div>
      </div>
      
      <div class="media-info">
        <div class="media-title-section">
          <h1 class="media-title">{{ mediaTitle }}</h1>
          <p v-if="originalTitle && originalTitle !== mediaTitle" class="original-title">
            {{ originalTitle }}
          </p>
          
          <div class="media-meta">
            <span v-if="releaseYear" class="meta-item year">{{ releaseYear }}</span>
            <span v-if="runtime" class="meta-item runtime">{{ formatRuntime(runtime) }}</span>
            <span v-if="rating" class="meta-item rating">
              <Icon name="star" class="rating-icon" />
              {{ rating.toFixed(1) }}
            </span>
            <span v-if="voteCount" class="meta-item votes">
              ({{ formatNumber(voteCount) }} {{ $t('common.votes') }})
            </span>
          </div>
          
          <!-- 类型标签 -->
          <div v-if="genres && genres.length > 0" class="genres">
            <span 
              v-for="genre in genres"
              :key="genre.id"
              class="genre-tag"
            >
              {{ genre.name }}
            </span>
          </div>
        </div>
        
        <!-- 操作按钮 -->
        <div class="media-actions">
          <button 
            class="action-btn primary"
            @click="handleScrape"
            :disabled="isLoading"
          >
            <Icon name="download" />
            {{ $t('common.scrape') }}
          </button>
          
          <button 
            class="action-btn secondary"
            @click="handleRefresh"
            :disabled="isLoading"
          >
            <Icon name="refresh" :class="{ 'animate-spin': isLoading }" />
            {{ $t('common.refresh') }}
          </button>
          
          <button 
            v-if="imdbId"
            class="action-btn secondary"
            @click="handleOpenIMDB"
          >
            <Icon name="external-link" />
            IMDB
          </button>
          
          <button 
            class="action-btn secondary"
            @click="handleManualMatch"
          >
            <Icon name="search" />
            {{ $t('common.manualMatch') }}
          </button>
        </div>
      </div>
    </div>
    
    <!-- 媒体描述 -->
    <div v-if="overview" class="media-overview">
      <h3 class="overview-title">{{ $t('common.overview') }}</h3>
      <p class="overview-text">{{ overview }}</p>
    </div>
    
    <!-- 详细信息 -->
    <div class="media-details-grid">
      <!-- 基本信息 -->
      <div class="detail-section">
        <h4 class="section-title">{{ $t('common.basicInfo') }}</h4>
        <div class="detail-list">
          <div v-if="status" class="detail-item">
            <span class="detail-label">{{ $t('common.status') }}:</span>
            <span class="detail-value">{{ status }}</span>
          </div>
          
          <div v-if="originalLanguage" class="detail-item">
            <span class="detail-label">{{ $t('common.originalLanguage') }}:</span>
            <span class="detail-value">{{ getLanguageName(originalLanguage) }}</span>
          </div>
          
          <div v-if="budget && mediaType === 'movie'" class="detail-item">
            <span class="detail-label">{{ $t('common.budget') }}:</span>
            <span class="detail-value">{{ formatCurrency(budget) }}</span>
          </div>
          
          <div v-if="revenue && mediaType === 'movie'" class="detail-item">
            <span class="detail-label">{{ $t('common.revenue') }}:</span>
            <span class="detail-value">{{ formatCurrency(revenue) }}</span>
          </div>
          
          <!-- 电视剧特有信息 -->
          <div v-if="numberOfSeasons && mediaType === 'tv'" class="detail-item">
            <span class="detail-label">{{ $t('common.seasons') }}:</span>
            <span class="detail-value">{{ numberOfSeasons }}</span>
          </div>
          
          <div v-if="numberOfEpisodes && mediaType === 'tv'" class="detail-item">
            <span class="detail-label">{{ $t('common.episodes') }}:</span>
            <span class="detail-value">{{ numberOfEpisodes }}</span>
          </div>
        </div>
      </div>
      
      <!-- 制作信息 -->
      <div v-if="productionCompanies && productionCompanies.length > 0" class="detail-section">
        <h4 class="section-title">{{ $t('common.production') }}</h4>
        <div class="production-companies">
          <div 
            v-for="company in productionCompanies.slice(0, 5)"
            :key="company.id"
            class="company-item"
          >
            <img 
              v-if="company.logo_path"
              :src="getImageUrl(company.logo_path, 'w92')"
              :alt="company.name"
              class="company-logo"
            />
            <span class="company-name">{{ company.name }}</span>
          </div>
        </div>
      </div>
      
      <!-- 演员信息 -->
      <div v-if="cast && cast.length > 0" class="detail-section cast-section">
        <h4 class="section-title">{{ $t('common.cast') }}</h4>
        <div class="cast-list">
          <div 
            v-for="actor in cast.slice(0, 6)"
            :key="actor.id"
            class="cast-item"
          >
            <img 
              v-if="actor.profile_path"
              :src="getImageUrl(actor.profile_path, 'w185')"
              :alt="actor.name"
              class="cast-photo"
            />
            <div v-else class="cast-photo-placeholder">
              <Icon name="user" />
            </div>
            <div class="cast-info">
              <p class="cast-name">{{ actor.name }}</p>
              <p class="cast-character">{{ actor.character }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 图片预览 -->
    <div v-if="images && (images.backdrops?.length > 0 || images.posters?.length > 0)" class="media-images">
      <h4 class="section-title">{{ $t('common.images') }}</h4>
      
      <div class="image-tabs">
        <button 
          class="tab-btn"
          :class="{ active: activeImageTab === 'backdrops' }"
          @click="activeImageTab = 'backdrops'"
        >
          {{ $t('common.backdrops') }} ({{ images.backdrops?.length || 0 }})
        </button>
        <button 
          class="tab-btn"
          :class="{ active: activeImageTab === 'posters' }"
          @click="activeImageTab = 'posters'"
        >
          {{ $t('common.posters') }} ({{ images.posters?.length || 0 }})
        </button>
      </div>
      
      <div class="image-grid">
        <div 
          v-for="(image, index) in currentImages"
          :key="index"
          class="image-item"
          @click="handleImageClick(image)"
        >
          <img 
            :src="getImageUrl(image.file_path, 'w300')"
            :alt="`${activeImageTab} ${index + 1}`"
            class="grid-image"
          />
          <div class="image-overlay">
            <span class="image-resolution">{{ image.width }}×{{ image.height }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- 空状态 -->
  <div v-else class="empty-state">
    <Icon name="film" class="empty-icon" />
    <h3 class="empty-title">{{ $t('common.noMediaSelected') }}</h3>
    <p class="empty-description">{{ $t('common.selectMediaToViewDetails') }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { 
  MovieInfoType, 
  TVInfoType, 
  Genre, 
  ProductionCompany, 
  CastMember, 
  ImageInfo 
} from '@/types'

/**
 * 媒体详情组件
 * 
 * 显示电影或电视剧的详细信息，包括基本信息、演员、制作公司、图片等
 * 支持电影和电视剧两种媒体类型
 */

// Props 定义
interface Props {
  /** 媒体信息 */
  mediaInfo?: MovieInfoType | TVInfoType | null
  /** 媒体类型 */
  mediaType: 'movie' | 'tv'
  /** 海报URL */
  posterUrl?: string
  /** 是否正在加载 */
  isLoading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  mediaInfo: null,
  posterUrl: '',
  isLoading: false
})

// Emits 定义
interface Emits {
  /** 刮削事件 */
  scrape: []
  /** 刷新事件 */
  refresh: []
  /** 手动匹配事件 */
  manualMatch: []
  /** 图片点击事件 */
  imageClick: [image: ImageInfo]
}

const emit = defineEmits<Emits>()

// 响应式数据
const activeImageTab = ref<'backdrops' | 'posters'>('backdrops')

// 计算属性
const mediaTitle = computed(() => {
  if (!props.mediaInfo) return ''
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
const voteCount = computed(() => props.mediaInfo?.vote_count)
const overview = computed(() => props.mediaInfo?.overview)
const genres = computed(() => props.mediaInfo?.genres)
const status = computed(() => props.mediaInfo?.status)
const originalLanguage = computed(() => props.mediaInfo?.original_language)

const budget = computed(() => {
  return props.mediaType === 'movie' ? (props.mediaInfo as MovieInfoType)?.budget : null
})

const revenue = computed(() => {
  return props.mediaType === 'movie' ? (props.mediaInfo as MovieInfoType)?.revenue : null
})

const numberOfSeasons = computed(() => {
  return props.mediaType === 'tv' ? (props.mediaInfo as TVInfoType)?.number_of_seasons : null
})

const numberOfEpisodes = computed(() => {
  return props.mediaType === 'tv' ? (props.mediaInfo as TVInfoType)?.number_of_episodes : null
})

const productionCompanies = computed(() => props.mediaInfo?.production_companies)

const cast = computed(() => props.mediaInfo?.credits?.cast)

const images = computed(() => props.mediaInfo?.images)

const imdbId = computed(() => {
  if (props.mediaType === 'movie') {
    return (props.mediaInfo as MovieInfoType)?.imdb_id
  } else {
    return (props.mediaInfo as TVInfoType)?.external_ids?.imdb_id
  }
})

const currentImages = computed(() => {
  if (!images.value) return []
  return activeImageTab.value === 'backdrops' 
    ? images.value.backdrops || []
    : images.value.posters || []
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

const formatNumber = (num: number): string => {
  return new Intl.NumberFormat().format(num)
}

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}

const getLanguageName = (code: string): string => {
  const languages: Record<string, string> = {
    'en': 'English',
    'zh': '中文',
    'ja': '日本語',
    'ko': '한국어',
    'fr': 'Français',
    'de': 'Deutsch',
    'es': 'Español',
    'it': 'Italiano',
    'pt': 'Português',
    'ru': 'Русский'
  }
  return languages[code] || code.toUpperCase()
}

const getImageUrl = (path: string, size: string = 'original'): string => {
  return `https://image.tmdb.org/t/p/${size}${path}`
}

// 事件处理函数
const handleScrape = () => {
  emit('scrape')
}

const handleRefresh = () => {
  emit('refresh')
}

const handleManualMatch = () => {
  emit('manualMatch')
}

const handleOpenIMDB = () => {
  if (imdbId.value) {
    window.open(`https://www.imdb.com/title/${imdbId.value}`, '_blank')
  }
}

const handleImageClick = (image: ImageInfo) => {
  emit('imageClick', image)
}

const handlePosterError = () => {
  // 处理海报加载错误
  console.warn('Failed to load poster image')
}
</script>

<style scoped>
.media-details {
  @apply p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm;
}

.media-header {
  @apply flex gap-6 mb-6;
}

.media-poster {
  @apply flex-shrink-0;
}

.poster-image {
  @apply w-48 h-72 object-cover rounded-lg shadow-md;
}

.poster-placeholder {
  @apply w-48 h-72 bg-gray-200 dark:bg-gray-700 rounded-lg 
         flex flex-col items-center justify-center text-gray-500 dark:text-gray-400;
}

.placeholder-icon {
  @apply w-12 h-12 mb-2;
}

.placeholder-text {
  @apply text-sm;
}

.media-info {
  @apply flex-1 flex flex-col justify-between;
}

.media-title {
  @apply text-3xl font-bold text-gray-900 dark:text-white mb-2;
}

.original-title {
  @apply text-lg text-gray-600 dark:text-gray-400 mb-3;
}

.media-meta {
  @apply flex items-center gap-4 mb-4;
}

.meta-item {
  @apply flex items-center text-sm text-gray-600 dark:text-gray-400;
}

.meta-item.year {
  @apply font-medium;
}

.rating-icon {
  @apply w-4 h-4 text-yellow-500 mr-1;
}

.genres {
  @apply flex flex-wrap gap-2 mb-4;
}

.genre-tag {
  @apply px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200
         text-sm rounded-full;
}

.media-actions {
  @apply flex gap-3;
}

.action-btn {
  @apply flex items-center gap-2 px-4 py-2 rounded-lg font-medium
         transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed;
}

.action-btn.primary {
  @apply bg-blue-600 hover:bg-blue-700 text-white;
}

.action-btn.secondary {
  @apply bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600
         text-gray-700 dark:text-gray-300;
}

.media-overview {
  @apply mb-6;
}

.overview-title {
  @apply text-lg font-semibold text-gray-900 dark:text-white mb-3;
}

.overview-text {
  @apply text-gray-700 dark:text-gray-300 leading-relaxed;
}

.media-details-grid {
  @apply grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 mb-6;
}

.detail-section {
  @apply bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4;
}

.section-title {
  @apply text-lg font-semibold text-gray-900 dark:text-white mb-3;
}

.detail-list {
  @apply space-y-2;
}

.detail-item {
  @apply flex justify-between;
}

.detail-label {
  @apply text-sm text-gray-600 dark:text-gray-400;
}

.detail-value {
  @apply text-sm font-medium text-gray-900 dark:text-white;
}

.production-companies {
  @apply space-y-3;
}

.company-item {
  @apply flex items-center gap-3;
}

.company-logo {
  @apply w-8 h-8 object-contain;
}

.company-name {
  @apply text-sm text-gray-700 dark:text-gray-300;
}

.cast-section {
  @apply lg:col-span-2 xl:col-span-3;
}

.cast-list {
  @apply grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4;
}

.cast-item {
  @apply text-center;
}

.cast-photo {
  @apply w-16 h-16 rounded-full object-cover mx-auto mb-2;
}

.cast-photo-placeholder {
  @apply w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-700
         flex items-center justify-center mx-auto mb-2 text-gray-400;
}

.cast-name {
  @apply text-sm font-medium text-gray-900 dark:text-white;
}

.cast-character {
  @apply text-xs text-gray-600 dark:text-gray-400;
}

.media-images {
  @apply border-t border-gray-200 dark:border-gray-700 pt-6;
}

.image-tabs {
  @apply flex gap-2 mb-4;
}

.tab-btn {
  @apply px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200;
}

.tab-btn.active {
  @apply bg-blue-600 text-white;
}

.tab-btn:not(.active) {
  @apply bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300
         hover:bg-gray-300 dark:hover:bg-gray-600;
}

.image-grid {
  @apply grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4;
}

.image-item {
  @apply relative cursor-pointer group;
}

.grid-image {
  @apply w-full aspect-video object-cover rounded-lg;
}

.image-overlay {
  @apply absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50
         flex items-end justify-center p-2 rounded-lg transition-all duration-200;
}

.image-resolution {
  @apply text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200;
}

.empty-state {
  @apply flex flex-col items-center justify-center py-12 text-center;
}

.empty-icon {
  @apply w-16 h-16 text-gray-400 mb-4;
}

.empty-title {
  @apply text-xl font-semibold text-gray-900 dark:text-white mb-2;
}

.empty-description {
  @apply text-gray-600 dark:text-gray-400;
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