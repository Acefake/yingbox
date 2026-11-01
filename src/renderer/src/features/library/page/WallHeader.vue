<template>
  <!-- 海报墙上方「全部」一段：标题与数量、右侧排序菜单（含匹配状态与文件夹）和筛选（番号页），下面是浏览胶囊或已选分面 -->
  <section class="lib-wall-head" :aria-label="title" data-wall-anchor>
    <UiSectionHeader :title="title">
      <template #title>
        <h2 class="yb-section-title">
          {{ title
          }}<span v-if="count !== null" class="lib-wall-count">{{
            count.toLocaleString('zh-CN')
          }}</span>
        </h2>
      </template>
      <UiButton
        v-if="facetScope"
        variant="glass"
        icon="filter"
        :label="facetCount ? `筛选 ${facetCount}` : '筛选'"
        :pressed="facetsOpen || facetCount > 0"
        :aria-expanded="facetsOpen"
        @click="facetsOpen = !facetsOpen"
      />
      <UiMenuButton
        variant="glass"
        :label="menuLabel"
        :icon="null"
        :items="menuItems"
      />
    </UiSectionHeader>
    <BrowseRow
      v-if="genreScope"
      v-model:view="view"
      v-model:browse="browse"
      v-model:genre="genre"
      :genres="genres"
      @recent="sortRecent"
    />
    <div v-if="facetScope" class="lib-wall-facets">
      <ActiveFacets v-model="facets" />
      <FacetPanel
        v-if="facetsOpen"
        v-model="facets"
        :scope="facetScope"
        :open="facetsOpen"
        @close="facetsOpen = false"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 海报墙上方的「全部」一段（排在继续观看、想看之后）：
 * - 标题「全部电影」与筛选后的数量；
 * - 右侧排序菜单：排序字段（点当前字段切换升降序），再是匹配状态与文件夹（多于一个时）两组单选，
 *   选了非默认的状态或文件夹时写进钮的文字；番号页另有「筛选」打开分面面板；
 * - 下面是浏览胶囊（电影 / 剧集等：全部 · 未看 · 最近添加 | 类型），番号页是已选分面。
 * 查询条件全部经 v-model 交回页面保管（切换视图后保留）。
 */
import { computed, ref, watch } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import type { MenuButtonItem } from '@/components/ui/UiMenuButton.vue'
import UiMenuButton from '@/components/ui/UiMenuButton.vue'
import UiSectionHeader from '@/components/ui/UiSectionHeader.vue'

import type {
  FacetFilter,
  FacetListRequest,
} from '../../../../../shared/library/ipc'
import ActiveFacets from '../facets/ActiveFacets.vue'
import FacetPanel from '../facets/FacetPanel.vue'
import { activeCount } from '../facets/facet-rules'
import {
  type BrowseMode,
  type MatchFilter,
  SORT_OPTIONS,
  type WallSort,
} from '../state/query-state'
import BrowseRow from './BrowseRow.vue'
import {
  libraryChoices,
  matchChoices,
  sortPick,
  wallMenuLabel,
} from './browse-rules'
import type { LibraryView } from './LibraryToolbar.vue'
import { useGenres } from './use-genres'

const props = defineProps<{
  kindLabel: string
  /** 海报墙条目数；null 时不显示。 */
  count: number | null
  /** 文件夹选项（含「全部文件夹」）；只有一个文件夹时菜单里不列。 */
  libraryOptions: Array<{ value: number; label: string }>
  sort: WallSort
  order: 'asc' | 'desc'
  /** 分面筛选的取值范围；不传表示该分区没有分面筛选。 */
  facetScope?: Omit<FacetListRequest, 'field'>
  /** 类型胶囊的计数范围；不传表示该分区没有浏览胶囊（番号页）。 */
  genreScope?: FacetListRequest
}>()

const view = defineModel<LibraryView>('view', { required: true })
const filter = defineModel<MatchFilter>('filter', { required: true })
const facets = defineModel<FacetFilter>('facets', { default: () => ({}) })
const browse = defineModel<BrowseMode>('browse', { default: 'all' })
const genre = defineModel<string | null>('genre', { default: null })
/** 0 表示全部文件夹。 */
const library = defineModel<number>('library', { required: true })

const emit = defineEmits<{
  sort: [value: WallSort]
  'toggle-order': []
}>()

const title = computed(() => `全部${props.kindLabel}`)
const genres = useGenres(() => props.genreScope)
const facetsOpen = ref(false)
const facetCount = computed(() => activeCount(facets.value))

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

/** 「最近添加」：排序切到添加时间降序。 */
function sortRecent(): void {
  if (props.sort !== 'addedAt') emit('sort', 'addedAt')
  else if (props.order !== 'desc') emit('toggle-order')
}

const libraryLabel = computed(() =>
  library.value
    ? (props.libraryOptions.find(o => o.value === library.value)?.label ?? null)
    : null
)

const menuLabel = computed(() =>
  wallMenuLabel(props.sort, props.order, filter.value, libraryLabel.value)
)

/** 排序字段打勾并带方向箭头，再点它切换升降序；然后是匹配状态与文件夹两组单选。 */
const menuItems = computed<MenuButtonItem[]>(() => [
  ...SORT_OPTIONS.map(o => ({
    key: `sort-${o.value}`,
    label: o.label,
    group: '排序',
    checked: o.value === props.sort,
    ...(o.value === props.sort
      ? { hint: props.order === 'asc' ? '↑' : '↓' }
      : {}),
    onSelect: () => {
      const step = sortPick(props.sort, o.value)
      if (step.kind === 'toggle-order') emit('toggle-order')
      else emit('sort', step.sort)
    },
  })),
  ...matchChoices(filter.value).map(c => ({
    ...c,
    onSelect: () => (filter.value = c.value),
  })),
  ...libraryChoices(props.libraryOptions, library.value).map(c => ({
    ...c,
    onSelect: () => (library.value = c.value),
  })),
])
</script>

<style scoped>
/*
 * 自成一层并略高于海报墙：排序菜单、类型浮层垂到海报上时不被海报格（will-change 合成层）盖住。
 * 下边距与海报墙网格的上外边距合并（poster-wall.css）。
 */
.lib-wall-head {
  position: relative;
  z-index: var(--z-raised);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: var(--space-4) var(--content-padding-x) var(--space-2);
}
.lib-wall-count {
  margin-left: var(--space-2_5);
  /* 分区色来自页面根节点（ambient/ambient-rules.ts） */
  color: var(--ambient-accent, var(--text-tertiary));
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.lib-wall-facets {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.lib-wall-facets:empty {
  display: none;
}
</style>
