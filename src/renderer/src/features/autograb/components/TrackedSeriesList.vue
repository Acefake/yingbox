<template>
  <section class="ag-section" aria-labelledby="ag-tracked-title">
    <h3 id="ag-tracked-title" class="ag-section-title">
      在追的剧<span class="ag-section-count">{{ tracked.length }}</span>
    </h3>
    <div v-if="tracked.length" class="ui-poster-grid">
      <UiPosterCard
        v-for="series in tracked"
        :key="series.seriesId"
        :title="series.title"
        :cover="posterOf(series)"
        :subtitle="describe(series)"
        @open="emit('open', series.seriesId)"
      >
        <template v-if="pending.get(series.seriesId)" #badges>
          <span class="ui-poster-badge">
            {{ pending.get(series.seriesId) }} 集待处理
          </span>
        </template>
      </UiPosterCard>
    </div>
    <p v-else class="ag-empty">
      还没有在追的剧。下面在播的剧点「追更」，或在剧集详情页点追更按钮。
    </p>

    <template v-if="untracked.length">
      <h3 class="ag-section-title ag-subsection">
        没在追的连载剧<span class="ag-section-count">{{
          untracked.length
        }}</span>
      </h3>
      <div class="ui-poster-grid">
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
 * 自动追更页「在追的剧」：首页同款海报墙（UiPosterCard + .ui-poster-grid），副标题是方式与下一集播出日，
 * 有待处理的集时海报左上角标出几集；点海报打开这部剧的侧拉面板。
 * 下面是在播或即将开播但没在追的连载剧，同样的海报墙：悬停右上角「+」一键追更（先按待确认追），点海报进面板细调。
 */
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import { libraryImage } from '@/features/library'
import type { AutograbSeries } from '../../../../../shared/contract/autograb'

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

/** 剧的海报（片库图片，取小图）；没有时卡片显示片名渐变 */
function posterOf(series: AutograbSeries): string | undefined {
  return (
    libraryImage(props.posters.get(series.seriesId) ?? null, 300) ?? undefined
  )
}

/** 副标题：全自动 · 下一集 11月3日（单独设的方式后面标「单独」） */
function describe(series: AutograbSeries): string {
  const mode = optionLabel(TV_MODE_OPTIONS, series.effectiveMode)
  return [
    isCustom(series.mode, series.prefs) ? `${mode}（单独）` : mode,
    nextAirText(series),
  ]
    .filter(Boolean)
    .join(' · ')
}
</script>

<style scoped src="./autograb-view.css"></style>
