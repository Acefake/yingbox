<template>
  <div class="vod-browse">
    <div class="vod-header">
      <div class="library-heading">
        <div class="heading-copy"><h1 class="yb-page-title">媒体库 <span class="yb-section-count">({{ filteredCards.length }})</span></h1><span v-if="loadingSources" class="loading-hint">加载中...</span></div>
        <div class="header-actions"><button type="button" class="yb-ghost-btn" :disabled="loading || loadingSources" @click="refreshCurrent">{{ loading ? '加载中…' : '刷新' }}</button></div>
      </div>
      <MediaFilterBar :rows="filterRows" :model-value="filters" @update:model-value="handleFilterUpdate" />
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="ui-error-state">
      <p>{{ error }}</p>
      <button class="ui-secondary-button" @click="retry">重新加载</button>
    </div>

    <!-- 空状态 -->
    <div v-if="!loading && !error && !filteredCards.length && !loadingSources" class="empty-state">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--text-quaternary)" stroke-width="1.5">
        <rect x="2" y="2" width="20" height="20" rx="2" />
        <path d="M10 9l5 3-5 3z" />
      </svg>
      <p>{{ sources.length ? '暂无内容' : '无法加载插件视频源，请检查后端是否运行' }}</p>
    </div>

    <!-- 内容卡片网格 -->
    <div v-if="filteredCards.length" class="yb-poster-grid">
      <div
        v-for="card in filteredCards"
        :key="card.vod_id + card._siteName"
        class="yb-poster-card"
        @click="handleOpenCard(card)"
      >
        <div class="yb-poster-media">
          <img
            :src="card.vod_pic"
            :alt="card.vod_name"
            loading="lazy"
            @error="onImgError"
          />
          <div class="yb-poster-overlay">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <div class="yb-poster-badge is-plugin">{{ card._siteName }}</div>
        </div>
        <div class="yb-poster-info">
          <div class="yb-poster-title" :title="card.vod_name">{{ card.vod_name }}</div>
          <div v-if="card.vod_remarks" class="yb-poster-remarks">{{ card.vod_remarks }}</div>
        </div>
      </div>
    </div>

    <!-- 加载更多 -->
    <div v-if="filteredCards.length && hasMore" class="load-more">
      <button class="load-more-btn" :disabled="loading" @click="loadMore">
        <span v-if="loading" class="spinner" />
        {{ loading ? '加载中...' : '加载更多' }}
      </button>
    </div>

    <!-- 首次加载骨架 -->
    <div v-if="loading && !cards.length" class="yb-poster-grid">
      <div v-for="i in 8" :key="i" class="yb-poster-card">
        <div class="yb-poster-media" />
        <div class="yb-poster-info">
          <div class="yb-poster-skel-line" style="width: 80%" />
          <div class="yb-poster-skel-line" style="width: 50%; margin-top: 8px" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import MediaFilterBar, { type MediaFilterRow } from '@/components/MediaFilterBar.vue'
import { type VodCard, useVodBrowse } from '../composables/use-vod-browse'
import { type CmsItem, useOnlineSearch } from '../composables/use-online-search'

const emit = defineEmits<{
  openItem: [item: CmsItem]
}>()

const { loadCatSpiderSites, activeCatSpiderSites } = useOnlineSearch()

const {
  sources,
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
  reload,
  cardToCmsItem,
} = useVodBrowse()

const filters = ref<Record<string, string>>({ source: 'all', category: 'all', status: 'all', progress: 'all', genre: 'all', region: 'all', year: 'all', type: 'all' })
const filterRows = computed<MediaFilterRow[]>(() => [
  { key: 'type', label: '分类', options: [{ label: '全部', value: 'all' }, { label: '电影', value: '电影' }, { label: '电视剧', value: '电视剧' }, { label: '合集', value: '合集' }] },
  ...(sources.value.length ? [{ key: 'source', label: '来源', options: [{ label: '全部', value: 'all' }, ...sources.value.map((s, i) => ({ label: s.site.name, value: String(i) }))] }] : []),
  ...(activeTabs.value.length ? [{ key: 'category', label: '子分类', options: [{ label: '全部', value: 'all' }, ...activeTabs.value.map((t, i) => ({ label: t.name, value: String(i) }))] }] : []),
  { key: 'status', label: '状态', options: [{ label: '全部', value: 'all' }, { label: 'NFO识别', value: 'nfo' }, { label: 'TMDB识别', value: 'tmdb' }, { label: '智能识别', value: 'smart' }, { label: '未识别', value: 'unknown' }] },
  { key: 'progress', label: '进度', options: [{ label: '全部', value: 'all' }, { label: '未观看', value: 'unwatched' }, { label: '已观看', value: 'watched' }] },
  { key: 'genre', label: '风格', options: [{ label: '全部', value: 'all' }, ...['剧情','喜剧','动作','爱情','惊悚','犯罪','悬疑','战争','科幻','动画','恐怖','家庭','冒险','奇幻','历史','纪录','音乐','西部','其他'].map(label => ({ label, value: label }))] },
  { key: 'region', label: '地区', options: [{ label: '全部', value: 'all' }, ...['中国大陆','中国香港','中国台湾','美国','英国','法国','德国','意大利','西班牙','葡萄牙','韩国','日本','印度','泰国','其他'].map(label => ({ label, value: label }))] },
  { key: 'year', label: '年份', options: [{ label: '全部', value: 'all' }, ...['2026','2025','2024','2023','2022','2021','2020-2011','2010-2001','2000-1991','1990-1981','更早'].map(label => ({ label, value: label }))] },
])
const filteredCards = computed(() => cards.value.filter(card => {
  const year = filters.value.year
  const type = filters.value.type
  const metadata = card as any
  const matchesYear = year === 'all' || (year.includes('-') ? true : String(metadata.vod_year || '') === year)
  const typeName = String(metadata.type_name || '')
  const activeTabName = activeTabs.value[Number(filters.value.category)]?.name || ''
  const matchesType = type === 'all' || (type === '电视剧' ? /电视剧|剧集/.test(typeName || activeTabName) : typeName.includes(type) || (!typeName && activeTabName.includes(type)))
  return matchesYear && matchesType
}))
const handleFilterUpdate = (next: Record<string, string>) => {
  filters.value = next
  if (next.source !== 'all') switchSource(Number(next.source))
  if (next.category !== 'all' && next.type === 'all') switchTab(Number(next.category))
  if (next.type !== 'all') {
    const typeTabIndex = activeTabs.value.findIndex(tab => next.type === '电视剧'
      ? /电视剧|剧集/.test(tab.name)
      : tab.name.includes(next.type))
    if (typeTabIndex >= 0) {
      filters.value = { ...filters.value, category: String(typeTabIndex) }
      switchTab(typeTabIndex)
    }
  }
}

const handleOpenCard = (card: VodCard): void => {
  emit('openItem', cardToCmsItem(card))
}

const retry = async (): Promise<void> => {
  await loadCatSpiderSites()
  const sites = activeCatSpiderSites()
  if (sites.length) await loadSources(sites)
}

const refreshCurrent = (): void => {
  if (sources.value.length) reload()
  else void retry()
}

const onImgError = (e: Event): void => {
  ;(e.target as HTMLImageElement).src =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160"><rect width="120" height="160" fill="%23374151"/><text x="60" y="85" text-anchor="middle" fill="%236b7280" font-size="12">无图</text></svg>'
}

onMounted(() => { void retry() })
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

.library-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.heading-copy { display:flex; align-items:center; min-width:0; }
.library-heading .yb-page-title { display:inline-flex; align-items:baseline; gap:6px; font-size:var(--text-xl); }
.library-heading .yb-section-count { font-size:var(--text-sm); }
.header-actions { display:flex; align-items:center; gap:8px; min-width:0; }

.loading-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-left: 8px;
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
  min-height: var(--control-height);
  padding: 0 24px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--bg-fill-secondary);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: var(--transition-fast);
}
.load-more-btn:hover:not(:disabled) {
  background: var(--bg-glass-hover);
  color: var(--text-primary);
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
  color: var(--text-tertiary);
  font-size: 14px;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-default);
  border-top-color: var(--text-secondary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .library-heading { align-items: flex-start; flex-direction: column; gap: 10px; }
  .header-actions { width: 100%; }
}
</style>
