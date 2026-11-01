<template>
  <!-- 工具栏：第一行大标题（选了类型时带「· 类型」）与数量、右侧排序 / 筛选 / ⋯；第二行浏览胶囊；再下面是待确认提示 -->
  <header class="lib-toolbar">
    <div class="lib-toolbar-head">
      <div class="lib-toolbar-title">
        <h1>
          {{ kindLabel
          }}<span v-if="shownGenre" class="lib-toolbar-genre">
            · {{ shownGenre }}</span
          >
        </h1>
        <span v-if="count !== null" class="lib-toolbar-count">{{
          count.toLocaleString('zh-CN')
        }}</span>
        <UiSegmented
          v-if="showSwitch && hasLibraries"
          class="lib-toolbar-switch"
          size="sm"
          :model-value="view === 'actors' ? 'actors' : 'wall'"
          label="视图"
          :options="viewOptions"
          @update:model-value="view = $event"
        />
      </div>
      <div class="lib-toolbar-tools">
        <UiMenuButton
          v-if="shows('sort')"
          variant="glass"
          :label="sortLabel(sort, order)"
          :icon="null"
          :items="sortItems"
        />
        <UiButton
          v-if="shows('facets')"
          variant="glass"
          icon="filter"
          :label="facetCount ? `筛选 ${facetCount}` : '筛选'"
          :pressed="facetsOpen || facetCount > 0"
          :aria-expanded="facetsOpen"
          @click="facetsOpen = !facetsOpen"
        />
        <UiMenuButton icon-only variant="glass" :items="moreItems" />
      </div>
    </div>
    <BrowseRow
      v-if="hasLibraries && genreScope && view !== 'actors'"
      v-model:view="view"
      v-model:browse="browse"
      v-model:genre="genre"
      :genres="genres"
      @recent="sortRecent"
    />
    <ReviewHint
      v-if="hasLibraries && view !== 'actors'"
      v-model:view="view"
      :count="reviewCount ?? 0"
    />
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
 * 媒体库页面工具栏（Apple TV 式）：第一行大标题与数量，右侧只有排序（「添加时间 ↓」：菜单里点别的字段换字段、
 * 点当前字段切换升降序）、筛选（番号页）和「⋯」。「⋯」里依次是扫描、识别、按画面搜、视频墙、设置，
 * 然后是「匹配状态」与「媒体库」（多于一个时）两组单选。摆放规则见 page-rules.ts toolbarActions。
 *
 * 电影 / 剧集分区第二行是浏览胶囊（BrowseRow：全部 · 未看 · 最近添加 | 常见类型 · 全部类型 ›），
 * 选了类型时标题显示「电影 · 科幻」、数量是筛选后的片数；番号页没有这一行。
 * 标题下方是待确认提示（ReviewHint），点了进入待确认队列。视图切换（资料库 / 演员，番号页才有）在标题旁。
 * 查询条件全部经 v-model 交回页面保管（切换视图后保留）。
 * 搜索用顶栏全局搜索（按 ?q= 在本页过滤），工具栏不再放第二个搜索框。
 */
import UiButton from '@/components/ui/UiButton.vue'
import type { MenuButtonItem } from '@/components/ui/UiMenuButton.vue'
import UiMenuButton from '@/components/ui/UiMenuButton.vue'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'

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
  type BrowseMode,
  type MatchFilter,
  SORT_OPTIONS,
  type WallSort,
} from '../state/query-state'
import BrowseRow from './BrowseRow.vue'
import {
  libraryChoices,
  matchChoices,
  sortLabel,
  sortPick,
  titleGenre,
} from './browse-rules'
import { type ToolbarAction, toolbarActions } from './page-rules'
import ReviewHint from './ReviewHint.vue'
import { useGenres } from './use-genres'

/** 页面视图。 */
export type LibraryView = 'wall' | 'actors' | 'review'

const props = defineProps<{
  kindLabel: string
  /** 海报墙条目数；null 时不显示。 */
  count: number | null
  hasLibraries: boolean
  viewOptions: SegmentedOption<LibraryView>[]
  /** 待确认条目数（标题下的提示） */
  reviewCount?: number
  /** 媒体库选项（含「全部文件夹」）；只有一个媒体库时「⋯」里不列。 */
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

const genres = useGenres(() => props.genreScope)
const shownGenre = computed(() => titleGenre(view.value, genre.value))
const showSwitch = computed(
  () => props.hasLibraries && props.viewOptions.length > 1
)

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

/** 排序菜单：当前字段打勾并带方向箭头，再点它切换升降序。 */
const sortItems = computed<MenuButtonItem[]>(() =>
  SORT_OPTIONS.map(o => ({
    key: o.value,
    label: o.label,
    checked: o.value === props.sort,
    ...(o.value === props.sort
      ? { hint: props.order === 'asc' ? '↑' : '↓' }
      : {}),
    onSelect: () => {
      const step = sortPick(props.sort, o.value)
      if (step.kind === 'toggle-order') emit('toggle-order')
      else emit('sort', step.sort)
    },
  }))
)

/** 「最近添加」：排序切到添加时间降序。 */
function sortRecent(): void {
  if (props.sort !== 'addedAt') emit('sort', 'addedAt')
  else if (props.order !== 'desc') emit('toggle-order')
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

/** 「⋯」菜单里每个操作的文字、图标与动作 */
const MORE: Partial<Record<ToolbarAction, Omit<MenuButtonItem, 'key'>>> = {
  scan: { label: '扫描', icon: 'refresh', onSelect: () => emit('scan') },
  identify: {
    label: '识别',
    icon: 'sparkle',
    onSelect: () => emit('identify'),
  },
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

/** 选匹配状态：回到海报墙。 */
function pickFilter(value: MatchFilter): void {
  filter.value = value
  view.value = 'wall'
}

const moreItems = computed<MenuButtonItem[]>(() => {
  const items: MenuButtonItem[] = actions.value.more.flatMap(key => {
    const item = MORE[key]
    return item ? [{ key, ...item }] : []
  })
  if (!props.hasLibraries || view.value === 'actors') return items
  const inWall = view.value === 'wall'
  for (const c of matchChoices(filter.value))
    items.push({
      ...c,
      checked: inWall && c.checked,
      onSelect: () => pickFilter(c.value),
    })
  if (inWall)
    for (const c of libraryChoices(props.libraryOptions, library.value))
      items.push({ ...c, onSelect: () => (library.value = c.value) })
  return items
})
</script>

<style scoped src="./library-toolbar.css"></style>
