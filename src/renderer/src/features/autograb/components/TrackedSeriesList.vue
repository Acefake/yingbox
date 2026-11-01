<template>
  <section class="ag-section" aria-labelledby="ag-tracked-title">
    <div class="ag-section-head">
      <h3 id="ag-tracked-title" class="ag-section-title">
        在追的剧<span class="ag-section-count">{{ tracked.length }} 部</span>
      </h3>
      <UiSegmented
        v-if="showFilter"
        :model-value="active"
        class="ag-section-action"
        :options="filterOptions"
        label="按追更方式筛选"
        size="sm"
        @update:model-value="value => (filter = value)"
      />
    </div>
    <div
      v-if="shown.length || untracked.length"
      class="ui-poster-grid ag-posters"
    >
      <UiPosterCard
        v-for="series in shown"
        :key="series.seriesId"
        :title="series.title"
        :cover="posterOf(series)"
        :subtitle="nextAirText(series) || modeText(series)"
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
      <UiPressable
        v-if="untracked.length && active === 'all'"
        class="ag-more-tile"
        :aria-expanded="untrackedOpen"
        @click="untrackedOpen = !untrackedOpen"
      >
        <span class="ag-more-icon"
          ><UiIcon :name="untrackedOpen ? 'chevronUp' : 'plus'"
        /></span>
        <span class="ag-more-title">还有 {{ untracked.length }} 部没追</span>
        <span class="ag-more-names">{{ untrackedNames }}</span>
      </UiPressable>
    </div>
    <p v-else class="ag-empty">
      还没有在追的剧。在剧集详情页点「追更」，或等库里的连载剧开播后出现在这里。
    </p>

    <template v-if="untracked.length && untrackedOpen && active === 'all'">
      <h3 class="ag-section-title ag-subsection">
        没在追的连载剧<span class="ag-section-count"
          >点「+」先按待确认追，点海报细调</span
        >
      </h3>
      <div class="ui-poster-grid ag-posters">
        <UiPosterCard
          v-for="series in untracked"
          :key="series.seriesId"
          :title="series.title"
          :cover="posterOf(series)"
          :subtitle="nextAirText(series) || '没在追'"
          @open="emit('open', series.seriesId)"
        >
          <template #actions>
            <UiIconButton
              icon="plus"
              variant="overlay"
              size="sm"
              :label="`追更 ${series.title}`"
              :loading="busy.has(series.seriesId)"
              @click.stop="emit('track', series)"
            />
          </template>
        </UiPosterCard>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
/**
 * 自动追更页「在追的剧」：首页同款海报墙（UiPosterCard + .ui-poster-grid）。海报左上角玻璃胶囊是实际方式
 * （全自动带星标；单独设的标「单独」），右上角蓝色数字是待处理集数，副标题是下一集播出日；点海报打开这部剧的侧拉面板。
 * 方式不止一种时标题右侧可按方式筛选。墙的最后一格是「还有 N 部没追」，点开在下面列出在播或即将开播但没在追的连载剧：
 * 悬停右上角「+」一键追更（先按待确认追），点海报进面板细调。
 */
import { computed, ref } from 'vue'

import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { libraryImage } from '@/features/library'
import type {
  AutograbMode,
  AutograbSeries,
} from '../../../../../shared/contract/autograb'

import { nextAirText } from '../autograb-rules'
import { TV_MODE_OPTIONS, isCustom, optionLabel } from '../prefs-rules'

const props = defineProps<{
  tracked: AutograbSeries[]
  untracked: AutograbSeries[]
  /** 剧 id → 海报（片库条目的 poster 原样） */
  posters: ReadonlyMap<number, string | null>
  /** 剧 id → 待处理集数 */
  pending: ReadonlyMap<number, number>
  /** 正在设置的剧 id */
  busy: ReadonlySet<number>
}>()
const emit = defineEmits<{
  open: [seriesId: number]
  track: [series: AutograbSeries]
}>()

type Filter = 'all' | AutograbMode
const filter = ref<Filter>('all')
const untrackedOpen = ref(false)

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
const shown = computed(() =>
  active.value === 'all'
    ? props.tracked
    : props.tracked.filter(series => series.effectiveMode === active.value)
)
const untrackedNames = computed(() =>
  props.untracked
    .slice(0, 2)
    .map(series => series.title)
    .join('、')
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
  return isCustom(series.mode, series.prefs) ? `${mode} · 单独` : mode
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

/* 墙的最后一格：与海报同宽同比例的虚线框 */
.ag-more-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  aspect-ratio: 2 / 3;
  padding: var(--space-3);
  border-radius: var(--radius-card);
  box-shadow: inset 0 0 0 1px var(--border-default);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  text-align: center;
  transition: background var(--duration-fast) var(--ease-out);
}

.ag-more-tile:hover {
  background: var(--bg-glass-hover);
}

.ag-more-icon {
  display: grid;
  place-items: center;
  width: var(--control-height);
  height: var(--control-height);
  border-radius: var(--radius-full);
  background: var(--control-bg);
  color: var(--text-primary);
}

.ag-more-title {
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
}
</style>
