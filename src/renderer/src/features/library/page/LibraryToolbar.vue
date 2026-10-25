<template>
  <!-- 工具栏：标题与数量、视图切换、搜索筛选排序、操作 -->
  <header class="lib-toolbar">
    <div class="lib-toolbar-title">
      <h1>{{ kindLabel }}</h1>
      <span v-if="count !== null" class="lib-toolbar-count">{{
        count.toLocaleString('zh-CN')
      }}</span>
    </div>
    <div class="lib-toolbar-tools">
      <UiSegmented
        v-if="hasLibraries && viewOptions.length > 1"
        v-model="view"
        class="lib-toolbar-views"
        size="sm"
        label="视图"
        :options="viewOptions"
      />
      <template v-if="hasLibraries && view === 'wall'">
        <label class="lib-sort yb-glass">
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
        <UiIconButton
          class="lib-round yb-glass"
          :icon="order === 'asc' ? 'arrowUp' : 'arrowDown'"
          :label="order === 'asc' ? '升序' : '降序'"
          @click="emit('toggle-order')"
        />
        <UiIconButton
          v-if="facetScope"
          class="lib-round yb-glass lib-facets-button"
          icon="filter"
          :label="facetCount ? `筛选 ${facetCount}` : '筛选'"
          :active="facetsOpen || facetCount > 0"
          :aria-expanded="facetsOpen"
          @click="facetsOpen = !facetsOpen"
        />
        <UiIconButton
          v-if="facetScope"
          class="lib-round yb-glass"
          icon="image"
          label="按画面"
          @click="visualOpen = true"
        />
      </template>
      <UiIconButton
        v-if="hasLibraries && tonight"
        class="lib-round yb-glass"
        icon="moon"
        label="今晚看什么"
        @click="openTonight"
      />
      <UiIconButton
        v-if="hasLibraries && view === 'wall' && count"
        class="lib-round yb-glass"
        icon="grid"
        label="视频墙"
        @click="emit('video-wall')"
      />
      <UiIconButton
        v-if="hasLibraries"
        class="lib-round yb-glass"
        icon="refresh"
        label="扫描"
        @click="emit('scan')"
      />
      <UiIconButton
        v-if="hasLibraries"
        class="lib-round yb-glass"
        icon="sparkle"
        label="识别全部"
        @click="emit('identify')"
      />
      <UiIconButton
        class="lib-round yb-glass"
        icon="settings"
        label="设置"
        @click="emit('settings')"
      />
    </div>
    <!-- 筛选胶囊：匹配状态，媒体库多于一个时后面接媒体库 -->
    <div
      v-if="hasLibraries && view === 'wall'"
      v-scroll-x
      class="lib-toolbar-chips"
      role="group"
      aria-label="筛选"
    >
      <UiChip
        v-for="o in filterOptions"
        :key="o.value"
        size="lg"
        :label="o.label"
        :selected="filter === o.value"
        @click="filter = o.value"
      />
      <template v-if="libraryOptions.length > 2">
        <span class="lib-chip-divider" aria-hidden="true" />
        <UiChip
          v-for="o in libraryOptions"
          :key="`lib-${o.value}`"
          size="lg"
          :label="o.label"
          :selected="library === o.value"
          @click="library = o.value"
        />
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
    <TonightSheet
      v-if="tonightMounted"
      :open="tonightOpen"
      @close="tonightOpen = false"
      @open-item="id => emit('open-item', id)"
    />
  </header>
</template>

<script setup lang="ts">
/**
 * 媒体库页面工具栏（Apple TV 式）：第一行大标题与数量，右侧资料库 / 演员（番号库）/ 待确认切换、玻璃排序胶囊与方向、
 * 分面筛选与按画面搜（番号库）、今晚看什么（电影 / 剧集）、视频墙、扫描 / 识别 / 设置（玻璃圆钮，文字在提示里）；
 * 第二行筛选胶囊（匹配状态，媒体库多于一个时接着列出各媒体库）。
 * 查询条件全部经 v-model 交回页面保管（切换视图后保留）。
 * 搜索用顶栏全局搜索（按 ?q= 在本页过滤），工具栏不再放第二个搜索框。
 */
import UiChip from '@/components/ui/UiChip.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'

import { computed, ref } from 'vue'
import type {
  FacetFilter,
  FacetListRequest,
} from '../../../../../shared/library/ipc'
import ActiveFacets from '../facets/ActiveFacets.vue'
import FacetPanel from '../facets/FacetPanel.vue'
import { activeCount } from '../facets/facet-rules'
import TonightSheet from '../tonight/TonightSheet.vue'
import VisualSearch from '../visual/VisualSearch.vue'
import {
  FILTER_OPTIONS,
  type MatchFilter,
  SORT_OPTIONS,
  type WallSort,
} from '../state/query-state'

/** 页面视图。 */
export type LibraryView = 'wall' | 'actors' | 'review'

defineProps<{
  kindLabel: string
  /** 海报墙条目数；null 时不显示。 */
  count: number | null
  hasLibraries: boolean
  viewOptions: SegmentedOption<LibraryView>[]
  /** 媒体库下拉（含「全部文件夹」）；只有一个媒体库时不显示。 */
  libraryOptions: Array<{ value: number; label: string }>
  sort: WallSort
  order: 'asc' | 'desc'
  /** 分面筛选的取值范围；不传表示该分区没有分面筛选。 */
  facetScope?: Omit<FacetListRequest, 'field'>
  /** 显示「今晚看什么」（电影 / 剧集分区）。 */
  tonight?: boolean
}>()

const view = defineModel<LibraryView>('view', { required: true })
const filter = defineModel<MatchFilter>('filter', { required: true })
const facets = defineModel<FacetFilter>('facets', { default: () => ({}) })
const facetsOpen = ref(false)
const visualOpen = ref(false)
const facetCount = computed(() => activeCount(facets.value))
/** 「今晚看什么」面板：第一次打开才挂载，之后保留（再打开时条件和结果还在） */
const tonightOpen = ref(false)
const tonightMounted = ref(false)

function openTonight(): void {
  tonightMounted.value = true
  tonightOpen.value = true
}

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
</script>

<style scoped>
.lib-toolbar {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-4) var(--space-6);
  padding: var(--space-6) var(--content-padding-x) var(--space-5);
}
.lib-toolbar-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2_5);
  min-width: 0;
}
.lib-toolbar-title h1 {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-weight-semibold);
  line-height: 1.1;
  letter-spacing: var(--tracking-tight);
}
.lib-toolbar-count {
  color: var(--text-tertiary);
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.lib-toolbar-tools {
  display: flex;
  flex: 1 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2_5);
}
/* 排序：玻璃胶囊里放 UiSelect（原生下拉，键盘、读屏照旧），左侧图标只是装饰 */
.lib-sort {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
  height: 40px;
  padding: 0 var(--space-3_5);
  border-radius: var(--radius-full);
  color: var(--text-primary);
  cursor: pointer;
}
.lib-sort:focus-within {
  box-shadow: var(--focus-ring);
}
/* UiSelect 外壳去掉边框与底色，融进玻璃胶囊；自带的下拉箭头贴右 */
.lib-sort-field {
  width: auto;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}
.lib-sort-field:focus-within {
  box-shadow: none;
}
.lib-sort-field :deep(.ui-select-native) {
  padding: 0 var(--space-5) 0 0;
  color: inherit;
}
.lib-sort-field :deep(.ui-select-chevron) {
  right: 0;
}
.lib-sort-field :deep(option) {
  background: var(--bg-elevated);
  color: var(--text-primary);
}
/* 图标按钮基类是透明底，玻璃底色在这里补上（模糊与阴影来自 .yb-glass） */
.lib-round {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
  background: var(--glass-bg);
  color: var(--text-primary);
}
/* 已高亮的圆钮悬停时保持反色底，不被玻璃悬停色盖掉 */
.lib-round:hover:not(:disabled):not(.is-active) {
  background: var(--glass-bg-hover);
}
.lib-round.is-active {
  background: var(--text-primary);
  color: var(--bg-content);
}
.lib-toolbar-chips {
  display: flex;
  flex: 1 0 100%;
  align-items: center;
  gap: var(--space-2);
  overflow-x: auto;
  scrollbar-width: none;
}
.lib-chip-divider {
  flex: none;
  width: 1px;
  height: 18px;
  margin: 0 var(--space-1);
  background: var(--border-glass-light);
}
.lib-toolbar-facets {
  display: flex;
  flex: 1 0 100%;
  flex-direction: column;
  gap: var(--space-3);
}
.lib-toolbar-facets:empty {
  display: none;
}
</style>
