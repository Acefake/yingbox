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
          v-enter="() => handleSearch(kw)"
          class="history-tag"
          role="button"
          tabindex="0"
          @click="handleSearch(kw)"
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

    <p v-if="skippedPlugins.length" class="skipped-note" role="status">
      {{ skippedPlugins.length }} 个插件源暂不可用，已跳过：{{
        skippedPlugins.join('、')
      }}
    </p>

    <StatusState
      v-if="!results.length && !loading && !error"
      icon="search"
      title="输入关键词搜索"
    />

    <!-- 首屏：还没有任何结果时的骨架 -->
    <UiSkeleton v-if="waiting === 'skeleton'" :count="8" label="正在搜索" />

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
            thumb
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
            thumb
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

    <!-- 已有结果、其他源还在搜：放在最后，出现 / 消失不推动正在看的结果 -->
    <UiLoadingDots
      v-if="waiting === 'more'"
      class="search-more"
      label="仍在搜索其他源"
    />
  </div>
</template>

<script setup lang="ts">
import { confirmDialog } from '@/components/ui'
import { vEnter } from '@/directives/enter'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import PageTitle from '@/components/PageTitle.vue'
import StatusState from '@/components/StatusState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { listWaiting } from '@/components/ui/feedback'
import { readStoredArray, saveStoredArray } from '@/utils/storage'
import { computed, ref, watch } from 'vue'

import { useRoute, useRouter } from 'vue-router'
import { type CmsItem, useOnlineSearch } from '../composables/use-online-search'

const emit = defineEmits<{
  (e: 'openItem', item: CmsItem): void
}>()

const {
  keyword,
  results,
  loading,
  error,
  skippedPlugins,
  search: doSearch,
} = useOnlineSearch()
const route = useRoute()
const router = useRouter()

const waiting = computed(() => listWaiting(loading.value, results.value.length))
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

const saveHistory = (kw: string): void => {
  const list = searchHistory.value.filter(s => s !== kw)
  list.unshift(kw)
  searchHistory.value = list.slice(0, 20)
  saveStoredArray(HISTORY_KEY, searchHistory.value)
}

const removeHistory = (kw: string): void => {
  searchHistory.value = searchHistory.value.filter(s => s !== kw)
  saveStoredArray(HISTORY_KEY, searchHistory.value)
}

const clearHistory = (): void => {
  void confirmDialog({
    title: '清空搜索记录？',
    content: `将清除本机保存的 ${searchHistory.value.length} 条搜索记录。`,
    okText: '清空',
    danger: true,
    onOk: () => {
      searchHistory.value = []
      localStorage.removeItem(HISTORY_KEY)
    },
  })
}

const handleSearch = async (kw?: string): Promise<void> => {
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
.skipped-note {
  margin: 0 0 var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
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

.search-more {
  align-self: center;
}
</style>
