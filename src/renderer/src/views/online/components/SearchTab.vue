<template>
  <div class="content-area search-tab">
    <div class="search-bar">
      <div class="search-inner">
        <input v-model="keyword" class="search-input" placeholder="搜索电影、电视剧..."
          @keydown.enter="handleSearch()" />
        <button class="search-btn" :disabled="loading" @click="handleSearch()">
          <svg v-if="!loading" viewBox="0 0 24 24" width="18" height="18" fill="none"
            stroke="currentColor" stroke-width="2">
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
        <button class="clear-btn" @click="clearHistory">清空</button>
      </div>
      <div class="history-tags">
        <span v-for="kw in searchHistory" :key="kw" class="history-tag" @click="emit('search', kw)">
          {{ kw }}
          <span class="del-tag" @click.stop="removeHistory(kw)">✕</span>
        </span>
      </div>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <div v-if="!results.length && !loading" class="empty-search">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none"
        stroke="rgba(255,255,255,0.2)" stroke-width="1.5">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <p>输入关键词搜索</p>
    </div>

    <div v-else class="result-grid">
      <div v-for="item in results" :key="item.vod_name" class="result-card"
        @click="emit('openItem', item)">
        <div class="card-poster">
          <img :src="item.vod_pic" :alt="item.vod_name" loading="lazy" @error="onImgError" />
          <div class="card-overlay">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <div v-if="item.sources && item.sources.length > 1" class="source-badge">
            {{ item.sources.length }}源
          </div>
        </div>
        <div class="card-info">
          <div class="card-title" :title="item.vod_name">{{ item.vod_name }}</div>
          <div class="card-meta">
            <span class="tag-year">{{ item.vod_year }}</span>
            <span class="tag-type">{{ item.type_name }}</span>
          </div>
          <div v-if="item.vod_remarks" class="card-remarks">{{ item.vod_remarks }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useOnlineSearch, type CmsItem } from '../composables/use-online-search'

const emit = defineEmits<{
  (e: 'search', kw: string): void
  (e: 'openItem', item: CmsItem): void
}>()

const { keyword, results, loading, error, search: doSearch } = useOnlineSearch()

const HISTORY_KEY = 'online_search_history'
const searchHistory = ref<string[]>(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'))

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
  searchHistory.value = []
  localStorage.removeItem(HISTORY_KEY)
}

const handleSearch = async (kw?: string) => {
  const q = kw ?? keyword.value
  if (!q.trim()) return
  keyword.value = q
  saveHistory(q.trim())
  await doSearch(q)
}

const onImgError = (e: Event) => {
  (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160"><rect width="120" height="160" fill="%23374151"/><text x="60" y="85" text-anchor="middle" fill="%236b7280" font-size="12">无图</text></svg>'
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

.content-area::-webkit-scrollbar { width: 4px; }
.content-area::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.search-tab .search-bar { padding: 0 0 8px; }

.search-bar { flex-shrink: 0; -webkit-app-region: no-drag; }

.search-inner {
  display: flex;
  gap: 8px;
  max-width: 640px;
  margin: 0 auto;
}

.search-input {
  flex: 1;
  height: 44px;
  padding: 0 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  color: white;
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
}

.search-input::placeholder { color: rgba(255, 255, 255, 0.4); }
.search-input:focus { border-color: rgba(255, 255, 255, 0.4); }

.search-btn {
  width: 44px;
  height: 44px;
  background: rgba(99, 102, 241, 0.8);
  border: none;
  border-radius: 10px;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
  flex-shrink: 0;
}

.search-btn:hover { background: rgba(99, 102, 241, 1); }
.search-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}

@keyframes spin { to { transform: rotate(360deg); } }

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  flex: 1;
}

.clear-btn {
  font-size: 11px;
  padding: 2px 10px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
}

.clear-btn:hover { color: rgba(255, 255, 255, 0.8); }

.history-tags { display: flex; flex-wrap: wrap; gap: 6px; }

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

.history-tag:hover { background: rgba(99, 102, 241, 0.25); color: white; }

.del-tag { font-size: 10px; opacity: 0.5; }
.del-tag:hover { opacity: 1; color: #f87171; }

.error-msg { text-align: center; color: rgba(255, 100, 100, 0.8); padding: 40px; }

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
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: transform 0.2s, border-color 0.2s;
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

.card-poster img { width: 100%; height: 100%; object-fit: cover; }

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

.result-card:hover .card-overlay { opacity: 1; }

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

.card-info { padding: 8px; }

.card-title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.card-meta { display: flex; flex-wrap: wrap; gap: 4px; margin: 3px 0; }

.tag-year, .tag-type {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
}

.card-remarks {
  font-size: 11px;
  color: rgba(255, 200, 100, 0.8);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
