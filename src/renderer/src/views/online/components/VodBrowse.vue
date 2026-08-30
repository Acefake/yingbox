<template>
  <div class="vod-browse">
    <!-- 顶部：源选择 + 分类 tab -->
    <div class="vod-header">
      <!-- 源选择器 -->
      <div class="source-selector">
        <button
          v-for="(src, idx) in sources"
          :key="src.site.api"
          :class="['source-btn', { active: activeSourceIdx === idx }]"
          @click="switchSource(idx)"
        >
          {{ src.site.name }}
        </button>
        <span v-if="loadingSources" class="loading-hint">加载中...</span>
      </div>

      <!-- 分类 tab -->
      <div v-if="activeTabs.length" class="category-tabs">
        <button
          v-for="(tab, idx) in activeTabs"
          :key="tab.name"
          :class="['tab-btn', { active: activeTabIdx === idx }]"
          @click="switchTab(idx)"
        >
          {{ tab.name }}
        </button>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="error-msg">{{ error }}</div>

    <!-- 空状态 -->
    <div v-if="!loading && !error && !cards.length && !loadingSources" class="empty-state">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5">
        <rect x="2" y="2" width="20" height="20" rx="2" />
        <path d="M10 9l5 3-5 3z" />
      </svg>
      <p>{{ sources.length ? '暂无内容' : '无法加载 VOD 源，请检查后端是否运行' }}</p>
    </div>

    <!-- 内容卡片网格 -->
    <div v-if="cards.length" class="cards-grid">
      <div
        v-for="card in cards"
        :key="card.vod_id + card._siteName"
        class="card-item"
        @click="handleOpenCard(card)"
      >
        <div class="card-poster">
          <img
            :src="card.vod_pic"
            :alt="card.vod_name"
            loading="lazy"
            @error="onImgError"
          />
          <div class="card-play-overlay">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <div class="card-source-badge">{{ card._siteName }}</div>
        </div>
        <div class="card-info">
          <div class="card-title" :title="card.vod_name">{{ card.vod_name }}</div>
          <div v-if="card.vod_remarks" class="card-remarks">{{ card.vod_remarks }}</div>
        </div>
      </div>
    </div>

    <!-- 加载更多 -->
    <div v-if="cards.length && hasMore" class="load-more">
      <button class="load-more-btn" :disabled="loading" @click="loadMore">
        <span v-if="loading" class="spinner" />
        {{ loading ? '加载中...' : '加载更多' }}
      </button>
    </div>

    <!-- 首次加载骨架 -->
    <div v-if="loading && !cards.length" class="cards-grid">
      <div v-for="i in 8" :key="i" class="card-item skeleton">
        <div class="card-poster skeleton-poster" />
        <div class="card-info">
          <div class="skeleton-line w80" />
          <div class="skeleton-line w50" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useVodBrowse, type VodCard } from '../composables/use-vod-browse'
import { useOnlineSearch, type CmsItem } from '../composables/use-online-search'

const emit = defineEmits<{
  openItem: [item: CmsItem]
}>()

const { CATSPIDER_SITES } = useOnlineSearch()

const {
  sources,
  activeSourceIdx,
  activeTabIdx,
  activeTabs,
  cards,
  loading,
  loadingSources,
  error,
  hasMore,
  loadSources,
  switchSource,
  switchTab,
  loadMore,
  cardToCmsItem,
} = useVodBrowse()

const handleOpenCard = (card: VodCard): void => {
  emit('openItem', cardToCmsItem(card))
}

const onImgError = (e: Event): void => {
  ;(e.target as HTMLImageElement).src =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160"><rect width="120" height="160" fill="%23374151"/><text x="60" y="85" text-anchor="middle" fill="%236b7280" font-size="12">无图</text></svg>'
}

onMounted(() => {
  if (CATSPIDER_SITES.length > 0) {
    loadSources(CATSPIDER_SITES)
  }
})
</script>

<style scoped>
.vod-browse {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

/* ── 头部：源选择 + 分类 ── */
.vod-header {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.source-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.source-btn {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.source-btn:hover:not(.active) {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
}
.source-btn.active {
  background: rgba(99, 102, 241, 0.7);
  border-color: rgba(99, 102, 241, 0.8);
  color: white;
  font-weight: 600;
}

.loading-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
  margin-left: 8px;
}

.category-tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.tab-btn {
  padding: 5px 12px;
  border-radius: 6px;
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.tab-btn:hover:not(.active) {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}
.tab-btn.active {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-weight: 500;
}

/* ── 卡片网格 ── */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px;
  flex: 1;
}

.card-item {
  cursor: pointer;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: transform 0.2s, border-color 0.2s;
}
.card-item:hover {
  transform: translateY(-3px);
  border-color: rgba(99, 102, 241, 0.4);
}

.card-poster {
  position: relative;
  aspect-ratio: 2/3;
  overflow: hidden;
  background: #1f2937;
}
.card-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-play-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}
.card-item:hover .card-play-overlay {
  opacity: 1;
}

.card-source-badge {
  position: absolute;
  bottom: 6px;
  right: 6px;
  background: rgba(16, 185, 129, 0.85);
  color: white;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
}

.card-info {
  padding: 8px;
}
.card-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 3px;
}
.card-remarks {
  font-size: 11px;
  color: rgba(255, 200, 100, 0.75);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 加载更多 ── */
.load-more {
  display: flex;
  justify-content: center;
  padding: 8px 0 16px;
}
.load-more-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 24px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.load-more-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
}
.load-more-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── 空状态 ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 0;
  color: rgba(255, 255, 255, 0.3);
  font-size: 14px;
}

.error-msg {
  text-align: center;
  color: rgba(255, 100, 100, 0.8);
  padding: 20px;
}

/* ── 骨架屏 ── */
.skeleton .skeleton-poster {
  background: linear-gradient(90deg, #1f2937 25%, #374151 50%, #1f2937 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
.skeleton-line {
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(90deg, #1f2937 25%, #374151 50%, #1f2937 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  margin-bottom: 6px;
}
.w80 { width: 80%; }
.w50 { width: 50%; }

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: rgba(255, 255, 255, 0.7);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
