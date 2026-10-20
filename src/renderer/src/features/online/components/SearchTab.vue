<template>
  <div class="content-area search-tab primary-scroll">
    <div v-if="searchHistory.length" class="home-section">
      <div class="yb-section-header">
        <PageTitle as="h2" variant="section">搜索记录</PageTitle>
        <UiIconButton
          icon="trash"
          label="清空搜索记录"
          danger
          @click="clearHistory"
        />
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
          <UiIconButton
            class="del-tag"
            icon="close"
            size="sm"
            danger
            :label="`删除搜索记录「${kw}」`"
            @click.stop="removeHistory(kw)"
            @keydown.enter.stop
          />
        </span>
      </div>
    </div>

    <div v-if="error" class="ui-error-state">
      <p>{{ error }}</p>
      <UiButton icon="search" label="重新搜索" @click="handleSearch()" />
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
        <PageTitle as="h2" variant="section">插件视频源</PageTitle>
        <span class="yb-section-count">{{ vodResults.length }}个结果</span>
      </div>
      <UiVirtualGrid
        :items="vodResults"
        class="ui-poster-grid"
        :item-key="item => item.vod_name + item.source_name"
      >
        <template #default="{ item }">
          <UiPosterCard
            :title="item.vod_name"
            :cover="item.vod_pic"
            :subtitle="
              [item.vod_year, item.type_name, item.vod_remarks]
                .filter(Boolean)
                .join(' · ')
            "
            @open="emit('openItem', item)"
          >
            <template #badges
              ><span class="ui-poster-badge">{{
                item.source_name
              }}</span></template
            >
          </UiPosterCard>
        </template>
      </UiVirtualGrid>
    </div>

    <!-- CMS 源结果 -->
    <div v-if="cmsResults.length" class="source-section source-section--spaced">
      <div class="yb-section-header">
        <PageTitle as="h2" variant="section">CMS源</PageTitle>
        <span class="yb-section-count">{{ cmsResults.length }}个结果</span>
      </div>
      <UiVirtualGrid
        :items="cmsResults"
        class="ui-poster-grid"
        :item-key="item => item.vod_name + item.source_name"
      >
        <template #default="{ item }">
          <UiPosterCard
            :title="item.vod_name"
            :cover="item.vod_pic"
            :subtitle="
              [item.vod_year, item.type_name, item.vod_remarks]
                .filter(Boolean)
                .join(' · ')
            "
            @open="emit('openItem', item)"
          >
            <template #badges
              ><span class="ui-poster-badge">{{
                item.source_name
              }}</span></template
            >
          </UiPosterCard>
        </template>
      </UiVirtualGrid>
    </div>
  </div>
</template>

<script setup lang="ts">
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import { confirmDialog } from '@/utils/confirm-dialog'
import PageTitle from '@/components/PageTitle.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { readStoredArray, saveStoredArray } from '@/utils/storage'
import { computed, ref, watch } from 'vue'

import { useRoute, useRouter } from 'vue-router'
import { type CmsItem, useOnlineSearch } from '../composables/use-online-search'

const emit = defineEmits<{
  (e: 'openItem', item: CmsItem): void
}>()

const { keyword, results, loading, error, search: doSearch } = useOnlineSearch()
const route = useRoute()
const router = useRouter()

const vodResults = computed(() =>
  results.value.filter(item => item._source === 'catspider')
)
const cmsResults = computed(() =>
  results.value.filter(item => item._source === 'cms' || !item._source)
)

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
  confirmDialog({
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

defineExpose({ handleSearch, saveHistory })
</script>

<style scoped>
.source-section--spaced {
  margin-top: var(--space-5);
}
.content-area {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6_5) var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.content-area::-webkit-scrollbar {
  width: 4px;
}
.content-area::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: var(--radius-xs);
}

.history-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.history-tag {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-height);
  padding: var(--space-0_5) var(--space-0_5) var(--space-0_5) var(--space-2);
  font-size: var(--text-xs);
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: var(--transition-fast);
}

.history-tag:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

.yb-icon-button.del-tag {
  --ib-size: 24px;
  opacity: 0.5;
}
.history-tag:hover .del-tag,
.del-tag:focus-visible {
  opacity: 1;
}

.empty-search {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding-top: var(--space-11);
  color: var(--text-tertiary);
  font-size: var(--text-md);
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-default);
  border-top-color: var(--text-primary);
  border-radius: 50%;
  animation: spin var(--duration-spin) linear infinite;
  display: inline-block;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
