<template>
  <div class="content-area search-tab primary-scroll">
    <div class="search-bar">
      <div class="search-inner">
        <input
          v-model="keyword"
          class="search-input"
          placeholder="搜索电影、电视剧..."
          @keydown.enter="handleSearch()"
        />
        <button class="search-btn" :disabled="loading" aria-label="搜索" @click="handleSearch()">
          <svg
            v-if="!loading"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <span v-else class="spinner" />
        </button>
      </div>
    </div>

    <div v-if="searchHistory.length" class="home-section">
      <div class="section-header">
        <span class="section-title">搜索记录</span>
        <button class="clear-btn" @click="clearHistory">清空记录</button>
      </div>
      <div class="history-tags">
        <span
          v-for="kw in searchHistory"
          :key="kw"
          class="history-tag"
          role="button"
          tabindex="0"
          @click="handleSearch(kw)"
          @keydown.enter="handleSearch(kw)"
        >
          {{ kw }}
          <button class="del-tag" :aria-label="`删除搜索记录 ${kw}`" @click.stop="removeHistory(kw)">✕</button>
        </span>
      </div>
    </div>

    <div v-if="error" class="ui-error-state">
      <p>{{ error }}</p>
      <button class="ui-secondary-button" @click="handleSearch()">重新搜索</button>
    </div>

    <div v-if="!results.length && !loading && !error" class="empty-search">
      <svg
        viewBox="0 0 24 24"
        width="48"
        height="48"
        fill="none"
        stroke="rgba(255,255,255,0.2)"
        stroke-width="1.5"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <p>输入关键词搜索</p>
    </div>

    <!-- VOD 源结果 -->
    <div v-if="vodResults.length" class="source-section">
      <div class="section-header">
        <span class="section-title">VOD源</span>
        <span class="section-count">{{ vodResults.length }}个结果</span>
      </div>
      <div class="result-grid">
        <div
          v-for="item in vodResults"
          :key="item.vod_name + item.source_name"
          class="result-card"
          @click="emit('openItem', item)"
        >
          <div class="card-poster">
            <img
              :src="item.vod_pic"
              :alt="item.vod_name"
              loading="lazy"
              @error="onImgError"
            />
            <div class="card-overlay">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div class="source-badge cs-badge">
              {{ item.source_name }}
            </div>
          </div>
          <div class="card-info">
            <div class="card-title" :title="item.vod_name">
              {{ item.vod_name }}
            </div>
            <div class="card-meta">
              <span class="tag-year">{{ item.vod_year }}</span>
              <span class="tag-type">{{ item.type_name }}</span>
            </div>
            <div v-if="item.vod_remarks" class="card-remarks">
              {{ item.vod_remarks }}
            </div>
            <div v-if="item.vod_content" class="card-desc">
              {{ item.vod_content.slice(0, 50) }}{{ item.vod_content.length > 50 ? '...' : '' }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- CMS 源结果 -->
    <div v-if="cmsResults.length" class="source-section" style="margin-top: 20px">
      <div class="section-header">
        <span class="section-title">CMS源</span>
        <span class="section-count">{{ cmsResults.length }}个结果</span>
      </div>
      <div class="result-grid">
        <div
          v-for="item in cmsResults"
          :key="item.vod_name + item.source_name"
          class="result-card"
          @click="emit('openItem', item)"
        >
          <div class="card-poster">
            <img
              :src="item.vod_pic"
              :alt="item.vod_name"
              loading="lazy"
              @error="onImgError"
            />
            <div class="card-overlay">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div class="source-badge">
              {{ item.source_name }}
            </div>
          </div>
          <div class="card-info">
            <div class="card-title" :title="item.vod_name">
              {{ item.vod_name }}
            </div>
            <div class="card-meta">
              <span class="tag-year">{{ item.vod_year }}</span>
              <span class="tag-type">{{ item.type_name }}</span>
            </div>
            <div v-if="item.vod_remarks" class="card-remarks">
              {{ item.vod_remarks }}
            </div>
            <div v-if="item.vod_content" class="card-desc">
              {{ item.vod_content.slice(0, 50) }}{{ item.vod_content.length > 50 ? '...' : '' }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Modal } from 'ant-design-vue'
import { useRoute } from 'vue-router'
import { useOnlineSearch, type CmsItem } from '../composables/use-online-search'

const emit = defineEmits<{
  (e: 'openItem', item: CmsItem): void
}>()

const { keyword, results, loading, error, search: doSearch } = useOnlineSearch()
const route = useRoute()

watch(
  () => route.query.q,
  async (query) => {
    if (typeof query === 'string') {
      keyword.value = query
      if (query.trim()) await doSearch(query)
    }
  },
  { immediate: true }
)

const vodResults = computed(() => results.value.filter(item => item._source === 'catspider'))
const cmsResults = computed(() => results.value.filter(item => item._source === 'cms' || !item._source))

const HISTORY_KEY = 'online_search_history'
const searchHistory = ref<string[]>(
  JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
)

const saveHistory = (kw: string) => {
  const list = searchHistory.value.filter(s => s !== kw)
  list.unshift(kw)
  searchHistory.value = list.slice(0, 20)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory.value))
}

const removeHistory = (kw: string) => {
  searchHistory.value = searchHistory.value.filter(s => s !== kw)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory.value))
}

const clearHistory = () => {
  Modal.confirm({
    title: '清空搜索记录？',
    content: `将清除本机保存的 ${searchHistory.value.length} 条搜索记录。`,
    okText: '清空',
    cancelText: '取消',
    okType: 'danger',
    onOk: () => {
      searchHistory.value = []
      localStorage.removeItem(HISTORY_KEY)
    },
  })
}

const handleSearch = async (kw?: string) => {
  const q = kw ?? keyword.value
  if (!q.trim()) return
  keyword.value = q
  saveHistory(q.trim())
  await doSearch(q)
}

const onImgError = (e: Event) => {
  ;(e.target as HTMLImageElement).src =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160"><rect width="120" height="160" fill="%23374151"/><text x="60" y="85" text-anchor="middle" fill="%236b7280" font-size="12">无图</text></svg>'
}

defineExpose({ handleSearch, saveHistory })
</script>

<style scoped>
.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.search-input,
.search-btn { min-height: var(--control-height); }

.history-tag { min-height: 32px; }

.del-tag {
  border: 0;
  padding: 2px;
  color: inherit;
  background: transparent;
}

.content-area::-webkit-scrollbar {
  width: 4px;
}
.content-area::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.search-tab .search-bar {
  padding: 0 0 8px;
}

.search-bar {
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.search-inner {
  display: flex;
  gap: 8px;
  max-width: 640px;
  margin: 0 auto;
}

.search-input {
  flex: 1;
  height: var(--control-height);
  padding: 0 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--radius-md);
  color: white;
  font-size: var(--text-md);
  outline: none;
  transition: border-color 0.2s;
}

.search-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}
.search-input:focus {
  border-color: rgba(255, 255, 255, 0.4);
}

.search-btn {
  width: 44px;
  height: var(--control-height);
  background: var(--primary);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
  flex-shrink: 0;
}

.search-btn:hover {
  background: var(--primary-hover);
}
.search-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.section-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  flex: 1;
}

.clear-btn {
  min-height: 32px;
  padding: 0 10px;
  font-size: var(--text-xs);
  background: var(--bg-glass);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
}

.clear-btn:hover {
  color: rgba(255, 255, 255, 0.8);
}

.history-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.history-tag {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.15s;
}

.history-tag:hover {
  background: rgba(99, 102, 241, 0.25);
  color: white;
}

.del-tag {
  font-size: 10px;
  opacity: 0.5;
}
.del-tag:hover {
  opacity: 1;
  color: #f87171;
}

.error-msg {
  text-align: center;
  color: rgba(255, 100, 100, 0.8);
  padding: 40px;
}

.empty-search {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding-top: 80px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 14px;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
}

.result-card {
  cursor: pointer;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition:
    transform 0.2s,
    border-color 0.2s;
}

.result-card:hover {
  transform: translateY(-3px);
  border-color: rgba(99, 102, 241, 0.5);
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

.card-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.result-card:hover .card-overlay {
  opacity: 1;
}

.source-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(99, 102, 241, 0.85);
  color: white;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
}

.cs-badge {
  top: auto;
  bottom: 6px;
  right: 6px;
  background: rgba(16, 185, 129, 0.85);
}

.card-info {
  padding: 8px;
}

.card-title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 3px 0;
}

.tag-year,
.tag-type {
  font-size: var(--text-xs);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
}

.card-remarks {
  font-size: var(--text-xs);
  color: rgba(255, 200, 100, 0.8);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-desc {
  font-size: var(--text-xs);
  color: rgba(255, 255, 255, 0.5);
  margin-top: 3px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
