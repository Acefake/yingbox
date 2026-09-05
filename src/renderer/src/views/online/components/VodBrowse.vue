<template>
  <div class="vod-browse">
    <div class="vod-header">
      <div class="library-heading">
        <div class="heading-copy"><h1>媒体库 <span>({{ filteredCards.length }})</span></h1><span v-if="loadingSources" class="loading-hint">加载中...</span></div>
        <div class="header-actions"><button type="button" class="header-action-btn" :disabled="loading || loadingSources" @click="refreshCurrent">{{ loading ? '加载中…' : '刷新' }}</button></div>
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
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5">
        <rect x="2" y="2" width="20" height="20" rx="2" />
        <path d="M10 9l5 3-5 3z" />
      </svg>
      <p>{{ sources.length ? '暂无内容' : '无法加载插件视频源，请检查后端是否运行' }}</p>
    </div>

    <!-- 内容卡片网格 -->
    <div v-if="filteredCards.length" class="cards-grid">
      <div
        v-for="card in filteredCards"
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
    <div v-if="filteredCards.length && hasMore" class="load-more">
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
import { computed, onMounted, ref } from 'vue'
import MediaFilterBar, { type MediaFilterRow } from '@/components/MediaFilterBar.vue'
import { useVodBrowse, type VodCard } from '../composables/use-vod-browse'
import { useOnlineSearch, type CmsItem } from '../composables/use-online-search'

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
.library-heading h1 { margin:0; color:rgba(255,255,255,.9); font-size:18px; font-weight:600; }
.library-heading h1 span { color:rgba(255,255,255,.42); font-size:14px; font-weight:400; }
.header-actions { display:flex; align-items:center; gap:8px; min-width:0; }
.header-action-btn { min-width:52px; height:36px; padding:0 12px; border:1px solid rgba(255,255,255,.12); border-radius:9px; color:rgba(255,255,255,.72); background:rgba(255,255,255,.05); font-size:13px; cursor:pointer; transition:background .15s ease, color .15s ease; }
.header-action-btn:hover:not(:disabled) { color:#fff; background:rgba(255,255,255,.12); }
.header-action-btn:disabled { opacity:.5; cursor:not-allowed; }

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
  background: rgba(10, 132, 255, 0.7);
  border-color: rgba(10, 132, 255, 0.8);
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
  min-height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-md);
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
  font-size: var(--text-xs);
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
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: transform 0.2s, border-color 0.2s;
}
.card-item:hover {
  transform: translateY(-3px);
  border-color: rgba(10, 132, 255, 0.4);
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
  font-size: var(--text-xs);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.card-info {
  padding: 8px;
}
.card-title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 3px;
}
.card-remarks {
  font-size: var(--text-xs);
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
  min-height: var(--control-height);
  padding: 0 24px;
  border-radius: var(--radius-md);
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

@media (max-width: 640px) {
  .library-heading { align-items: flex-start; flex-direction: column; gap: 10px; }
  .header-actions { width: 100%; }
}
</style>
