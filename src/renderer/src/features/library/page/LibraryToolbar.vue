<template>
  <!-- 工具栏：第一行大标题与数量、右侧操作；第二行视图切换 + 筛选胶囊 -->
  <header class="lib-toolbar">
    <div class="lib-toolbar-head">
      <div class="lib-toolbar-title">
        <h1>{{ kindLabel }}</h1>
        <span v-if="count !== null" class="lib-toolbar-count">{{
          count.toLocaleString('zh-CN')
        }}</span>
      </div>
      <div class="lib-toolbar-tools">
        <label v-if="shows('sort')" class="lib-sort">
          <UiIcon name="sort" size="sm" />
          <UiSelect
            class="lib-sort-field"
            aria-label="排序"
            :options="sortOptions"
            :value="sort"
            @change="
              emit(
                'sort',
                ($event.target as HTMLSelectElement).value as WallSort
              )
            "
          />
        </label>
        <UiButton
          v-if="shows('order')"
          :icon="order === 'asc' ? 'arrowUp' : 'arrowDown'"
          :label="order === 'asc' ? '升序' : '降序'"
          @click="emit('toggle-order')"
        />
        <UiButton
          v-if="shows('facets')"
          icon="filter"
          :label="facetCount ? `筛选 ${facetCount}` : '筛选'"
          :pressed="facetsOpen || facetCount > 0"
          :aria-expanded="facetsOpen"
          @click="facetsOpen = !facetsOpen"
        />
        <UiButton
          v-if="shows('scan')"
          icon="refresh"
          label="扫描"
          @click="emit('scan')"
        />
        <UiButton
          v-if="shows('identify')"
          icon="sparkle"
          label="识别"
          @click="emit('identify')"
        />
        <UiMenuButton :items="moreItems" />
      </div>
    </div>
    <!-- 视图切换与筛选胶囊排成一行：资料库 / 演员 | 匹配状态（待确认带数量）| 各媒体库 -->
    <div
      v-if="hasLibraries && (showSwitch || view !== 'actors')"
      v-scroll-x
      class="lib-toolbar-row"
    >
      <UiSegmented
        v-if="showSwitch"
        :model-value="view === 'actors' ? 'actors' : 'wall'"
        label="视图"
        :options="viewOptions"
        @update:model-value="view = $event"
      />
      <template v-if="view !== 'actors'">
        <span v-if="showSwitch" class="lib-row-divider" aria-hidden="true" />
        <div class="lib-chips" role="group" aria-label="匹配状态">
          <UiChip
            v-for="o in filterOptions"
            :key="o.value"
            size="md"
            :label="o.label"
            :count="
              o.value === 'review'
                ? reviewChipCount(reviewCount ?? 0)
                : undefined
            "
            :selected="chipSelected(o.value)"
            @click="pickFilter(o.value)"
          />
        </div>
        <template v-if="view === 'wall' && libraryOptions.length > 2">
          <span class="lib-row-divider" aria-hidden="true" />
          <div class="lib-chips" role="group" aria-label="媒体库">
            <UiChip
              v-for="o in libraryOptions"
              :key="`lib-${o.value}`"
              size="md"
              :label="o.label"
              :selected="library === o.value"
              @click="library = o.value"
            />
          </div>
        </template>
      </template>
    </div>
    <!-- 分面筛选（番号库）：已选条件常驻，面板按「筛选」展开 -->
    <div
      v-if="facetScope && hasLibraries && view === 'wall'"
      class="lib-toolbar-facets"
    >
      <ActiveFacets v-model="facets" />
      <FacetPanel
        v-if="facetsOpen"
        v-model="facets"
        :scope="facetScope"
        :open="facetsOpen"
        @close="facetsOpen = false"
      />
    </div>
    <VisualSearch
      v-if="facetScope"
      v-model:open="visualOpen"
      :library-id="facetScope.libraryId ?? null"
      @open-item="id => ((visualOpen = false), emit('open-item', id))"
    />
  </header>
</template>

<script setup lang="ts">
/**
 * 媒体库页面工具栏（Apple TV 式）：第一行大标题与数量，右侧图标 + 文字按钮（排序、升降、筛选、扫描、识别），
 * 其余操作（按画面搜、视频墙、设置）收进「更多」，摆放规则见 page-rules.ts toolbarActions；
 * 第二行把视图切换（资料库 / 演员，番号页才有）和筛选胶囊排成一行：匹配状态（「待确认」带数量，选它进入待确认队列），
 * 媒体库多于一个时接着列出各媒体库。
 * 查询条件全部经 v-model 交回页面保管（切换视图后保留）。
 * 搜索用顶栏全局搜索（按 ?q= 在本页过滤），工具栏不再放第二个搜索框。
 */
import UiButton from '@/components/ui/UiButton.vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import type { MenuButtonItem } from '@/components/ui/UiMenuButton.vue'
import UiMenuButton from '@/components/ui/UiMenuButton.vue'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'

import { computed, ref, watch } from 'vue'
import type {
  FacetFilter,
  FacetListRequest,
} from '../../../../../shared/library/ipc'
import ActiveFacets from '../facets/ActiveFacets.vue'
import FacetPanel from '../facets/FacetPanel.vue'
import { activeCount } from '../facets/facet-rules'
import VisualSearch from '../visual/VisualSearch.vue'
import {
  FILTER_OPTIONS,
  type MatchFilter,
  SORT_OPTIONS,
  type WallSort,
} from '../state/query-state'
import {
  type ToolbarAction,
  reviewChipCount,
  toolbarActions,
} from './page-rules'

/** 页面视图。 */
export type LibraryView = 'wall' | 'actors' | 'review'

const props = defineProps<{
  kindLabel: string
  /** 海报墙条目数；null 时不显示。 */
  count: number | null
  hasLibraries: boolean
  viewOptions: SegmentedOption<LibraryView>[]
  /** 待确认条目数（筛选胶囊上的数字） */
  reviewCount?: number
  /** 媒体库下拉（含「全部文件夹」）；只有一个媒体库时不显示。 */
  libraryOptions: Array<{ value: number; label: string }>
  sort: WallSort
  order: 'asc' | 'desc'
  /** 分面筛选的取值范围；不传表示该分区没有分面筛选。 */
  facetScope?: Omit<FacetListRequest, 'field'>
}>()

const view = defineModel<LibraryView>('view', { required: true })
const filter = defineModel<MatchFilter>('filter', { required: true })
const facets = defineModel<FacetFilter>('facets', { default: () => ({}) })
const facetsOpen = ref(false)
const visualOpen = ref(false)
const facetCount = computed(() => activeCount(facets.value))
/** 0 表示全部文件夹。 */
const library = defineModel<number>('library', { required: true })

const emit = defineEmits<{
  sort: [value: WallSort]
  'toggle-order': []
  scan: []
  identify: []
  settings: []
  'video-wall': []
  /** 按画面搜的结果里点开一部。 */
  'open-item': [itemId: number]
}>()

const sortOptions = SORT_OPTIONS.map(o => ({ ...o }))
const filterOptions = FILTER_OPTIONS.map(o => ({ ...o }))
const showSwitch = computed(
  () => props.hasLibraries && props.viewOptions.length > 1
)

/** 匹配状态胶囊：「待确认」对应待确认队列视图，其余是海报墙的筛选。 */
function chipSelected(value: MatchFilter): boolean {
  if (value === 'review') return view.value === 'review'
  return view.value === 'wall' && filter.value === value
}

// 海报墙的「待确认」筛选由待确认队列承担：带着这个筛选进来（如恢复的查询条件）就直接进队列
watch(
  filter,
  value => {
    if (value !== 'review') return
    filter.value = 'all'
    view.value = 'review'
  },
  { immediate: true }
)

function pickFilter(value: MatchFilter): void {
  if (value === 'review') {
    view.value = 'review'
    return
  }
  filter.value = value
  view.value = 'wall'
}

const actions = computed(() =>
  toolbarActions({
    view: view.value,
    hasLibraries: props.hasLibraries,
    count: props.count,
    facets: !!props.facetScope,
  })
)
const shows = (action: ToolbarAction): boolean =>
  actions.value.inline.includes(action)

/** 「更多」菜单里每个操作的文字、图标与动作 */
const MORE: Partial<Record<ToolbarAction, Omit<MenuButtonItem, 'key'>>> = {
  visual: {
    label: '按画面搜',
    icon: 'image',
    onSelect: () => (visualOpen.value = true),
  },
  'video-wall': {
    label: '视频墙',
    icon: 'grid',
    onSelect: () => emit('video-wall'),
  },
  settings: {
    label: '设置',
    icon: 'settings',
    onSelect: () => emit('settings'),
  },
}
const moreItems = computed<MenuButtonItem[]>(() =>
  actions.value.more.flatMap(key => {
    const item = MORE[key]
    return item ? [{ key, ...item }] : []
  })
)
</script>

<style scoped src="./library-toolbar.css"></style>
