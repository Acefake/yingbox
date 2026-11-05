<template>
  <!-- 海报墙上方「全部」一段：标题与数量，下面是浏览胶囊或已选分面 -->
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
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 海报墙上方的「全部」一段（排在继续观看、想看之后）：
 * - 标题「全部电影」与筛选后的数量；排序与筛选在页头（WallControls）；
 * - 下面是浏览胶囊（电影 / 剧集等：全部 · 未看 · 最近添加 | 类型），番号页是已选分面。
 * 查询条件全部经 v-model 交回页面保管（切换视图后保留）。
 */
import { computed, watch } from 'vue'

import UiSectionHeader from '@/components/ui/UiSectionHeader.vue'

import type {
  FacetFilter,
  FacetListRequest,
} from '../../../../../shared/library/ipc'
import ActiveFacets from '../facets/ActiveFacets.vue'
import {
  type BrowseMode,
  type MatchFilter,
  type WallSort,
} from '../state/query-state'
import BrowseRow from './BrowseRow.vue'
import type { LibraryView } from './LibraryToolbar.vue'
import { useGenres } from './use-genres'

const props = defineProps<{
  kindLabel: string
  /** 海报墙条目数；null 时不显示。 */
  count: number | null
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

const emit = defineEmits<{
  sort: [value: WallSort]
  'toggle-order': []
}>()

const title = computed(() => `全部${props.kindLabel}`)
const genres = useGenres(() => props.genreScope)

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
