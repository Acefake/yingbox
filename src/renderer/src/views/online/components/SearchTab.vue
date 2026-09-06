<template>
  <div class="content-area search-tab primary-scroll">
    <div v-if="searchHistory.length" class="home-section">
      <div class="yb-section-header">
        <h2 class="yb-section-title">搜索记录</h2>
        <button class="yb-ghost-btn" @click="clearHistory">清空记录</button>
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
        stroke="var(--text-quaternary)"
        stroke-width="1.5"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <p>输入关键词搜索</p>
    </div>

    <!-- 插件视频源结果 -->
    <div v-if="vodResults.length" class="source-section">
      <div class="yb-section-header">
        <h2 class="yb-section-title">插件视频源</h2>
        <span class="yb-section-count">{{ vodResults.length }}个结果</span>
      </div>
      <div class="yb-poster-grid">
        <div
          v-for="item in vodResults"
          :key="item.vod_name + item.source_name"
          class="yb-poster-card"
          @click="emit('openItem', item)"
        >
          <div class="yb-poster-media">
            <img
              :src="item.vod_pic"
              :alt="item.vod_name"
              loading="lazy"
              @error="onImgError"
            />
            <div class="yb-poster-overlay">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div class="yb-poster-badge is-plugin">
              {{ item.source_name }}
            </div>
          </div>
          <div class="yb-poster-info">
            <div class="yb-poster-title" :title="item.vod_name">
              {{ item.vod_name }}
            </div>
            <div class="yb-poster-meta">
              <span class="yb-poster-chip">{{ item.vod_year }}</span>
              <span class="yb-poster-chip is-accent">{{ item.type_name }}</span>
            </div>
            <div v-if="item.vod_remarks" class="yb-poster-remarks">
              {{ item.vod_remarks }}
            </div>
            <div v-if="item.vod_content" class="yb-poster-sub">
              {{ item.vod_content.slice(0, 50) }}{{ item.vod_content.length > 50 ? '...' : '' }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- CMS 源结果 -->
    <div v-if="cmsResults.length" class="source-section" style="margin-top: 20px">
      <div class="yb-section-header">
        <h2 class="yb-section-title">CMS源</h2>
        <span class="yb-section-count">{{ cmsResults.length }}个结果</span>
      </div>
      <div class="yb-poster-grid">
        <div
          v-for="item in cmsResults"
          :key="item.vod_name + item.source_name"
          class="yb-poster-card"
          @click="emit('openItem', item)"
        >
          <div class="yb-poster-media">
            <img
              :src="item.vod_pic"
              :alt="item.vod_name"
              loading="lazy"
              @error="onImgError"
            />
            <div class="yb-poster-overlay">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div class="yb-poster-badge is-source">
              {{ item.source_name }}
            </div>
          </div>
          <div class="yb-poster-info">
            <div class="yb-poster-title" :title="item.vod_name">
              {{ item.vod_name }}
            </div>
            <div class="yb-poster-meta">
              <span class="yb-poster-chip">{{ item.vod_year }}</span>
              <span class="yb-poster-chip is-accent">{{ item.type_name }}</span>
            </div>
            <div v-if="item.vod_remarks" class="yb-poster-remarks">
              {{ item.vod_remarks }}
            </div>
            <div v-if="item.vod_content" class="yb-poster-sub">
              {{ item.vod_content.slice(0, 50) }}{{ item.vod_content.length > 50 ? '...' : '' }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { readStoredArray, saveStoredArray } from '@/utils/storage'
import { ref, computed, watch } from 'vue'
import { Modal } from 'ant-design-vue'
import { useRoute, useRouter } from 'vue-router'
import { useOnlineSearch, type CmsItem } from '../composables/use-online-search'

const emit = defineEmits<{
  (e: 'openItem', item: CmsItem): void
}>()

const { keyword, results, loading, error, search: doSearch } = useOnlineSearch()
const route = useRoute()
const router = useRouter()

const vodResults = computed(() => results.value.filter(item => item._source === 'catspider'))
const cmsResults = computed(() => results.value.filter(item => item._source === 'cms' || !item._source))

const HISTORY_KEY = 'online_search_history'
const searchHistory = ref<string[]>(
  readStoredArray<string>(HISTORY_KEY, value => typeof value === 'string')
)

const saveHistory = (kw: string) => {
  const list = searchHistory.value.filter(s => s !== kw)
  list.unshift(kw)
  searchHistory.value = list.slice(0, 20)
  saveStoredArray(HISTORY_KEY, searchHistory.value)
}

const removeHistory = (kw: string) => {
  searchHistory.value = searchHistory.value.filter(s => s !== kw)
  saveStoredArray(HISTORY_KEY, searchHistory.value)
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
  const query = (kw ?? keyword.value).trim()
  if (!query) return
  if (route.query.q !== query) {
    await router.replace({ path: '/', query: { tab: 'search', q: query } })
    return
  }
  keyword.value = query
  saveHistory(query)
  await doSearch(query)
}

watch(
  () => route.query.q,
  async query => {
    if (typeof query !== 'string' || !query.trim()) {
      keyword.value = ''
      results.value = []
      error.value = ''
      return
    }
    await handleSearch(query)
  },
  { immediate: true }
)

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

.content-area::-webkit-scrollbar {
  width: 4px;
}
.content-area::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 2px;
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
  min-height: 32px;
  padding: 4px 10px;
  font-size: var(--text-xs);
  background: var(--bg-fill-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  cursor: pointer;
  transition: var(--transition-fast);
}

.history-tag:hover {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  color: var(--accent-text);
}

.del-tag {
  border: 0;
  padding: 2px;
  color: inherit;
  background: transparent;
  font-size: 10px;
  opacity: 0.5;
  cursor: pointer;
}
.del-tag:hover {
  opacity: 1;
  color: var(--danger);
}

.empty-search {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding-top: 80px;
  color: var(--text-tertiary);
  font-size: var(--text-md);
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-default);
  border-top-color: var(--text-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
