<template>
  <section class="ag-section" aria-labelledby="ag-tracked-title">
    <div class="ag-section-head">
      <h3 id="ag-tracked-title" class="ag-section-title">
        在追的剧<span class="ag-section-count">{{ activeCount }} 部</span>
      </h3>
      <UiSegmented
        v-if="categories.length > 1"
        :model-value="activeCategory"
        class="ag-section-action"
        :options="categoryOptions"
        label="按分类筛选"
        size="sm"
        @update:model-value="value => (category = value)"
      />
      <UiSegmented
        v-if="showFilter"
        :model-value="active"
        :options="filterOptions"
        label="按追更方式筛选"
        size="sm"
        @update:model-value="value => (filter = value)"
      />
    </div>
    <div v-if="shown.length" class="ui-poster-grid ag-posters">
      <UiPosterCard
        v-for="series in shown"
        :key="series.seriesId"
        :title="series.title"
        :cover="posterOf(series)"
        :subtitle="
          finished.has(series.seriesId)
            ? '已存完'
            : nextAirText(series) || modeText(series)
        "
        @open="emit('open', series.seriesId)"
      >
        <template #badges>
          <span class="ag-mode" :data-mode="series.effectiveMode">
            <UiIcon
              v-if="series.effectiveMode === 'auto'"
              name="sparkle"
              size="sm"
            />{{ modeText(series) }}
          </span>
        </template>
        <template v-if="pending.get(series.seriesId)" #overlay>
          <span class="ag-pending-count"
            ><span aria-hidden="true">{{ pending.get(series.seriesId) }}</span
            ><span class="ag-sr"
              >{{ pending.get(series.seriesId) }} 集待处理</span
            ></span
          >
        </template>
      </UiPosterCard>
    </div>
    <p v-else-if="!finished.size" class="ag-empty">
      还没有在追的剧。在上面搜索剧名，或在剧集详情页点「追更」。
    </p>
    <UiButton
      v-if="finishedCount"
      class="ag-finished-toggle"
      size="sm"
      variant="plain"
      :icon="showFinished ? 'chevronUp' : 'chevronDown'"
      :label="`${showFinished ? '收起' : '展开'}已存完 ${finishedCount} 部`"
      :aria-expanded="showFinished"
      @click="showFinished = !showFinished"
    />
  </section>
</template>

<script setup lang="ts">
/**
 * 自动追更页「在追的剧」：首页同款海报墙（UiPosterCard + .ui-poster-grid）。海报左上角玻璃胶囊是实际方式
 * （全自动带星标；单独设的标「单独」），右上角蓝色数字是待处理集数，副标题是下一集播出日；点海报打开这部剧的侧拉面板。
 * 方式不止一种时标题右侧可按方式筛选；只展示正在追更的剧。已存完的剧（finishedSeriesIds）默认收起，点底部按钮展开。
 */
import { computed, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { libraryImage } from '@/features/library'
import type {
  AutograbMode,
  AutograbSeries,
} from '../../../../../shared/contract/autograb'

import {
  SERIES_CATEGORY_LABEL,
  type SeriesCategory,
} from '../../../../../shared/contract/series-category'

import { categoriesIn, categoryOfSeries, nextAirText } from '../autograb-rules'
import { TV_MODE_OPTIONS, isCustom, optionLabel } from '../prefs-rules'

const props = defineProps<{
  tracked: AutograbSeries[]
  /** 剧 id → 海报（片库条目的 poster 原样） */
  posters: ReadonlyMap<number, string | null>
  /** 剧 id → 待处理集数 */
  pending: ReadonlyMap<number, number>
  /** 已存完的剧 id：默认收起 */
  finished: ReadonlySet<number>
}>()
const emit = defineEmits<{
  open: [seriesId: number]
}>()

type Filter = 'all' | AutograbMode
type CategoryFilter = 'all' | SeriesCategory
const filter = ref<Filter>('all')
const category = ref<CategoryFilter>('all')

/** 在追的剧里出现过的方式（只有一种时不出筛选） */
const modes = computed(
  () => new Set(props.tracked.map(series => series.effectiveMode))
)
const showFilter = computed(() => modes.value.size > 1)
const filterOptions = computed(() => [
  { value: 'all' as Filter, label: '全部' },
  ...TV_MODE_OPTIONS.filter(option =>
    modes.value.has(option.value as AutograbMode)
  ).map(option => ({ value: option.value as Filter, label: option.label })),
])
/** 实际生效的筛选：选过的方式已经没有剧了（或只剩一种、筛选收起）就回到全部 */
const active = computed<Filter>(() =>
  showFilter.value && filter.value !== 'all' && modes.value.has(filter.value)
    ? filter.value
    : 'all'
)
const categories = computed(() => categoriesIn(props.tracked))
const categoryOptions = computed(() => [
  { value: 'all' as CategoryFilter, label: '全部分类' },
  ...categories.value.map(item => ({
    value: item as CategoryFilter,
    label: SERIES_CATEGORY_LABEL[item],
  })),
])
/** 分类筛选选过的分类已经没有剧了就回到全部 */
const activeCategory = computed<CategoryFilter>(() =>
  category.value !== 'all' && categories.value.includes(category.value)
    ? category.value
    : 'all'
)
const showFinished = ref(false)
const activeCount = computed(
  () => props.tracked.filter(s => !props.finished.has(s.seriesId)).length
)
const finishedCount = computed(() => props.tracked.length - activeCount.value)
const shown = computed(() =>
  props.tracked
    .filter(
      series => showFinished.value || !props.finished.has(series.seriesId)
    )
    .filter(
      series =>
        (active.value === 'all' || series.effectiveMode === active.value) &&
        (activeCategory.value === 'all' ||
          categoryOfSeries(series) === activeCategory.value)
    )
)

/** 剧的海报（片库图片，取小图）；没有时卡片显示片名渐变 */
function posterOf(series: AutograbSeries): string | undefined {
  return (
    libraryImage(props.posters.get(series.seriesId) ?? null, 300) ?? undefined
  )
}

/** 方式胶囊：全自动 / 待确认（单独设的后面标「单独」） */
function modeText(series: AutograbSeries): string {
  const mode = optionLabel(TV_MODE_OPTIONS, series.effectiveMode)
  const text = isCustom(series.mode, series.prefs) ? `${mode} · 单独` : mode
  const kind = categoryOfSeries(series)
  return kind === 'tv' ? text : `${SERIES_CATEGORY_LABEL[kind]} · ${text}`
}
</script>

<style scoped src="./autograb-view.css"></style>
<style scoped>
.ag-mode {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 22px; /* style-tokens: layout（海报上的小胶囊高度） */
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--glass-media-bg);
  box-shadow: var(--glass-media-shadow);
  backdrop-filter: var(--glass-filter);
  color: var(--media-text);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}

.ag-pending-count {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  display: grid;
  place-items: center;
  min-width: 22px; /* style-tokens: layout（数字角标的最小宽度） */
  height: 22px; /* style-tokens: layout（数字角标高度） */
  padding: 0 var(--space-1_5);
  border-radius: var(--radius-full);
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.ag-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
