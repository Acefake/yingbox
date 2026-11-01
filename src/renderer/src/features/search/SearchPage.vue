<template>
  <div class="resource-search primary-scroll">
    <h1>搜索影片与资源</h1>
    <div class="resource-search-input">
      <UiInput
        v-model="draft"
        v-enter="submit"
        icon="search"
        placeholder="片名、年份、季集或想看的内容"
        aria-label="搜索影片与资源"
        clearable
      />
      <UiButton
        label="搜索"
        icon="search"
        :loading="search.busy.value && draft.trim() === queryText"
        @click="submit"
      />
    </div>
    <div class="resource-search-filters">
      <UiChip
        v-for="option in filters"
        :key="option.value"
        :label="option.label"
        :count="count(option.value)"
        :selected="filter === option.value"
        :aria-pressed="filter === option.value"
        @click="filter = option.value"
      />
    </div>
    <div class="resource-search-status" role="status" aria-live="polite">
      <span
        >{{ search.works.value.length }} 部影片 ·
        {{ search.resources.value.length }} 个资源</span
      >
      <UiLoadingDots v-if="search.busy.value" label="资源搜索中" />
    </div>
    <div
      v-for="[kind, state] in sourceStates"
      :key="kind"
      class="resource-search-source"
    >
      <span
        >{{ sourceLabels[kind] }} ·
        {{
          state.status === 'loading'
            ? '搜索中…'
            : kind === 'ai'
              ? '已完成'
              : `${state.count} 个资源`
        }}<template v-if="state.message"> · {{ state.message }}</template></span
      >
      <UiButton
        v-if="
          state.status === 'error' ||
          (kind !== 'ai' && state.message && state.status !== 'loading')
        "
        size="sm"
        label="重试"
        @click="search.retry(kind)"
      />
      <UiButton
        v-if="kind === 'online' && state.message"
        size="sm"
        label="数据源设置"
        @click="openSources"
      />
      <UiButton
        v-if="kind === 'netdisk' && state.message"
        size="sm"
        label="网盘设置"
        @click="openNetdiskSettings"
      />
    </div>
    <ResourcePanel
      v-if="selectedWork"
      ref="panel"
      :work="selectedWork"
      :query="search.query.value"
      @close="selected = ''"
      @online="search.online.open"
    />
    <p
      v-if="queryText && !search.busy.value && !shown.length"
      class="resource-search-empty"
    >
      没有找到匹配内容，可换用片名或原名，或检查资源来源配置。
    </p>
    <UiVirtualGrid
      :items="shown"
      :item-key="item => item.key"
      class="resource-search-results"
    >
      <template #default="{ item }">
        <UiMediaRow
          :title="item.title"
          :image="item.image"
          :year="item.year"
          dense
          :selected="selected === item.key"
          :label="`查看资源：${item.title}`"
          :aria-label="`查看资源：${item.title}`"
          :note="[
            item.possible ? '可能相关' : '匹配结果',
            resourceSummary(item),
            `${item.resources.length} 个资源`,
          ]"
          @open="selected = item.key"
        />
      </template>
    </UiVirtualGrid>
    <UiButton
      v-if="search.more.value"
      label="加载更多片库结果"
      :loading="search.moreBusy.value"
      @click="search.loadMore"
    />
    <p v-if="queryText" class="resource-search-foot">
      在线和网盘展示本次接口已返回的全部资源；未验证的结果不代表已可播放。
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  UiButton,
  UiChip,
  UiInput,
  UiLoadingDots,
  UiMediaRow,
  UiVirtualGrid,
} from '@/components/ui'
import { netdiskAvailable, openNetdiskSettings } from '@/features/netdisk'
import { vEnter } from '@/directives/enter'
import ResourcePanel from './ResourcePanel.vue'
import { useResourceSearch } from './use-resource-search'
import type { ResourceKind, SearchWork } from './types'
import type { ProviderKind } from './session'

const route = useRoute()
const router = useRouter()
const queryText = computed(() =>
  typeof route.query.q === 'string' ? route.query.q.trim().slice(0, 500) : ''
)
const draft = ref(queryText.value)
const filter = ref<'all' | ResourceKind>('all')
const selected = ref('')
const panel = ref<{ $el: HTMLElement } | null>(null)
watch(selected, async key => {
  if (!key) return
  await nextTick()
  panel.value?.$el.scrollIntoView({ block: 'nearest' })
})
const search = useResourceSearch(() => queryText.value)
const sourceLabels: Record<ProviderKind, string> = {
  local: '片库',
  online: '在线',
  netdisk: '115 / 磁力',
  ai: 'AI 理解',
}
const sourceStates = computed(
  () =>
    Object.entries(search.states.value ?? {}).filter(
      ([kind, state]) =>
        state.status !== 'idle' &&
        (kind !== 'ai' ||
          state.message ||
          state.status === 'error' ||
          state.status === 'loading')
    ) as [ProviderKind, NonNullable<typeof search.states.value>[ProviderKind]][]
)
const filters = computed(() => [
  { value: 'all' as const, label: '全部' },
  { value: 'local' as const, label: '片库' },
  ...(search.online.available
    ? [{ value: 'online' as const, label: '在线' }]
    : []),
  ...(netdiskAvailable
    ? [
        { value: 'share' as const, label: '115' },
        { value: 'magnet' as const, label: '磁力' },
      ]
    : []),
])
const shown = computed(() =>
  search.works.value.filter(
    work =>
      filter.value === 'all' ||
      work.resources.some(resource => resource.kind === filter.value)
  )
)
const selectedWork = computed(() =>
  search.works.value.find(work => work.key === selected.value)
)
const count = (kind: 'all' | ResourceKind): number =>
  kind === 'all'
    ? search.resources.value.length
    : search.resources.value.filter(resource => resource.kind === kind).length

function openSources(): void {
  window.dispatchEvent(
    new CustomEvent('app:open-settings', { detail: 'sources' })
  )
}

function resourceSummary(work: SearchWork): string {
  const labels = { local: '片库', online: '在线', share: '115', magnet: '磁力' }
  return [
    ...new Set(work.resources.map(resource => labels[resource.kind])),
  ].join(' / ')
}

function submit(): void {
  if (draft.value.trim() === queryText.value) {
    if (search.busy.value) return
    void search.run()
    return
  }
  void router.push({
    path: '/search',
    query: { q: draft.value.trim() || undefined },
  })
}

watch(queryText, text => {
  draft.value = text
  selected.value = ''
})
</script>

<style scoped>
.resource-search {
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  padding: var(--space-7) var(--content-padding-x);
}
.resource-search h1 {
  font-size: var(--page-title-size);
  font-weight: var(--font-weight-semibold);
  margin: 0 0 var(--space-5);
}
.resource-search-input,
.resource-search-filters,
.resource-search-status,
.resource-search-source {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.resource-search-input > :first-child {
  flex: 1;
}
.resource-search-filters {
  flex-wrap: wrap;
}
.resource-search-status,
.resource-search-source,
.resource-search-foot,
.resource-search-empty {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.resource-search-source {
  flex-wrap: wrap;
}
.resource-search-results {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
}
.resource-search-foot {
  margin-top: var(--space-5);
}
</style>
