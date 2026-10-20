<template>
  <AppModal
    :open="visible"
    :title="title"
    icon="search"
    :width="1000"
    :footer="null"
    :centered="true"
    :destroy-on-close="true"
    :z-index="9999"
    @cancel="$emit('close')"
  >
    <div class="msm-search">
      <AInput
        v-model:value="searchQuery"
        :placeholder="type === 'tv' ? '输入电视剧名称搜索' : '输入电影名称搜索'"
        size="large"
        @press-enter="handleResearch"
      />
      <UiButton
        variant="primary"
        icon="search"
        label="重新搜索"
        :loading="isSearching"
        @click="handleResearch"
      />
    </div>
    <div class="msm-results custom-scrollbar">
      <div
        v-if="results.length === 0 && !isSearching"
        class="ui-empty-state msm-empty"
      >
        <p>没有搜索结果</p>
        <span>请修改搜索关键词后点击「重新搜索」</span>
      </div>
      <div v-else class="ui-poster-grid">
        <UiPosterCard
          v-for="item in results"
          :key="item.id"
          :title="getTitle(item)"
          :cover="getPoster(item)"
          :subtitle="subtitleOf(item)"
          :rating="item.vote_average ? item.vote_average.toFixed(1) : undefined"
          :aria-busy="loadingId === item.id || undefined"
          :class="{ 'is-loading': loadingId === item.id }"
          @open="handlePick(item)"
        >
          <template #actions>
            <UiIconButton
              icon="check"
              variant="overlay"
              size="sm"
              :label="loadingId === item.id ? '处理中…' : '使用此结果'"
              :loading="loadingId === item.id"
              @click.stop="handlePick(item)"
            />
          </template>
        </UiPosterCard>
      </div>
    </div>
  </AppModal>
</template>

<script setup lang="ts">
/**
 * TMDB 搜索结果选择弹窗：重新搜索 + 海报网格，点选一个结果触发刮削。
 * 目前没有页面引用（已被统一刮削工作台取代），保留以兼容旧入口。
 */
import { Input as AInput } from 'ant-design-vue'
import { computed, ref, watch } from 'vue'

import AppModal from '@/components/AppModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'

export interface MediaResult {
  id: number
  poster_path?: string | null
  vote_average?: number
  overview?: string
  // movie
  title?: string
  original_title?: string
  release_date?: string
  // tv
  name?: string
  original_name?: string
  first_air_date?: string
}

interface Props {
  visible: boolean
  type: 'movie' | 'tv'
  results: MediaResult[]
  /** 正在处理的条目 ID（显示 loading 状态） */
  loadingId?: number | null
  /** 初始搜索查询 */
  initialQuery?: string
}

const props = withDefaults(defineProps<Props>(), {
  initialQuery: '',
})

const emit = defineEmits<{
  close: []
  /** 用户选中某个结果，触发刮削流程 */
  scrape: [item: MediaResult]
  /** 用户重新搜索 */
  research: [query: string]
}>()

const searchQuery = ref(props.initialQuery)
const isSearching = ref(false)

watch(
  () => props.initialQuery,
  newVal => {
    searchQuery.value = newVal
  }
)

const handleResearch = (): void => {
  if (!searchQuery.value.trim()) return
  isSearching.value = true
  emit('research', searchQuery.value)
}

watch(
  () => props.results,
  () => {
    isSearching.value = false
  }
)

const title = computed(() =>
  props.type === 'tv'
    ? `搜索结果 (${props.results.length} 部电视剧)`
    : `搜索结果 (${props.results.length} 部电影)`
)

const handlePick = (item: MediaResult): void => {
  if (props.loadingId != null) return
  emit('scrape', item)
}

const getTitle = (item: MediaResult): string => item.title ?? item.name ?? ''
const getOriginalTitle = (item: MediaResult): string =>
  item.original_title ?? item.original_name ?? ''

const getYear = (item: MediaResult): string => {
  const d = item.release_date ?? item.first_air_date
  return d ? String(new Date(d).getFullYear()) : ''
}

const getPoster = (item: MediaResult): string => item.poster_path || ''

/** 副标题：原名（与标题不同时）+ 年份 */
const subtitleOf = (item: MediaResult): string => {
  const original = getOriginalTitle(item)
  return [original !== getTitle(item) ? original : '', getYear(item)]
    .filter(Boolean)
    .join(' · ')
}
</script>

<style scoped>
.msm-search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
.msm-search .ui-button {
  height: var(--control-height-lg);
}
.msm-results {
  max-height: 80vh;
  padding: var(--space-2) 0;
  overflow-y: auto;
}
.msm-empty p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.msm-empty span {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.ui-poster.is-loading {
  opacity: 0.6;
  pointer-events: none;
}
</style>
