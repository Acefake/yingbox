<template>
  <!-- 页头右侧、操作按钮左边：筛选（番号页）与排序菜单（含匹配状态与文件夹） -->
  <div v-if="facetScope" ref="anchor" class="lib-facet-anchor">
    <UiButton
      variant="glass"
      icon="filter"
      :label="facetCount ? `筛选 ${facetCount}` : '筛选'"
      :pressed="facetsOpen || facetCount > 0"
      :aria-expanded="facetsOpen"
      @click="facetsOpen = !facetsOpen"
    />
    <FacetPopover
      v-if="facetsOpen"
      v-model="facets"
      :scope="facetScope"
      :trigger="anchor"
      @close="facetsOpen = false"
    />
  </div>
  <UiMenuButton
    variant="glass"
    :label="menuLabel"
    :icon="null"
    :items="menuItems"
  />
</template>

<script setup lang="ts">
/**
 * 页头里的筛选与排序：
 * - 排序菜单：排序字段（点当前字段切换升降序），再是匹配状态与文件夹（多于一个时）两组单选，
 *   选了非默认的状态或文件夹时写进钮的文字；
 * - 番号页另有「筛选」按钮，点开是浮在按钮下面的筛选弹层（FacetPopover）。
 * 查询条件全部经 v-model 交回页面保管（切换视图后保留）。
 */
import { computed, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import type { MenuButtonItem } from '@/components/ui/UiMenuButton.vue'
import UiMenuButton from '@/components/ui/UiMenuButton.vue'

import type {
  FacetFilter,
  FacetListRequest,
} from '../../../../../shared/library/ipc'
import { activeCount } from '../facets/facet-rules'
import FacetPopover from '../facets/FacetPopover.vue'
import {
  type MatchFilter,
  SORT_OPTIONS,
  type WallSort,
} from '../state/query-state'
import {
  libraryChoices,
  matchChoices,
  sortPick,
  wallMenuLabel,
} from './browse-rules'

const props = defineProps<{
  /** 文件夹选项（含「全部文件夹」）；只有一个文件夹时菜单里不列。 */
  libraryOptions: Array<{ value: number; label: string }>
  sort: WallSort
  order: 'asc' | 'desc'
  /** 分面筛选的取值范围；不传表示该分区没有分面筛选。 */
  facetScope?: Omit<FacetListRequest, 'field'>
}>()

const filter = defineModel<MatchFilter>('filter', { required: true })
const facets = defineModel<FacetFilter>('facets', { default: () => ({}) })
/** 0 表示全部文件夹。 */
const library = defineModel<number>('library', { required: true })
const facetsOpen = ref(false)
const anchor = ref<HTMLElement | null>(null)

const emit = defineEmits<{
  sort: [value: WallSort]
  'toggle-order': []
}>()

const facetCount = computed(() => activeCount(facets.value))

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
.lib-facet-anchor {
  position: relative;
}
</style>
