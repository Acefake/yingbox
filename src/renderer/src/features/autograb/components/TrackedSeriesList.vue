<template>
  <section class="ag-section" aria-labelledby="ag-tracked-title">
    <h3 id="ag-tracked-title" class="ag-section-title">
      在追的剧<span class="ag-section-count">{{ tracked.length }}</span>
    </h3>
    <SettingsGroup
      v-if="tracked.length"
      footer="点设置按钮改这部剧的追更方式、转存位置和资源偏好"
    >
      <SettingsRow
        v-for="series in tracked"
        :key="series.seriesId"
        :title="series.title"
        :description="describe(series)"
      >
        <span v-if="pending.get(series.seriesId)" class="ag-row-pending">
          {{ pending.get(series.seriesId) }} 集待处理
        </span>
        <UiIconButton
          icon="settings"
          size="sm"
          :label="`${series.title} 的追更设置`"
          @click="emit('open', series.seriesId)"
        />
      </SettingsRow>
    </SettingsGroup>
    <p v-else class="ag-empty">
      还没有在追的剧。下面在播的剧点「追更」，或在剧集详情页点追更按钮。
    </p>

    <SettingsGroup
      v-if="untracked.length"
      title="没在追的连载剧"
      footer="点「追更」先按待确认追，搜到资源等你确认；要全自动再进设置里改"
    >
      <SettingsRow
        v-for="series in untracked"
        :key="series.seriesId"
        :title="series.title"
        :description="nextAirText(series)"
      >
        <UiButton
          size="sm"
          label="追更"
          :loading="busy.has(series.seriesId)"
          @click="emit('track', series)"
        />
      </SettingsRow>
    </SettingsGroup>
  </section>
</template>

<script setup lang="ts">
/**
 * 自动追更页「在追的剧」：设置页同款玻璃分组，每部一行（剧名；方式 · 下一集播出日；有待处理时标出几集），
 * 行尾设置按钮打开这部剧的侧拉面板；下面一组是在播或即将开播但没在追的连载剧，一键「追更」。
 */
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import type { AutograbSeries } from '../../../../../shared/contract/autograb'

import { nextAirText } from '../autograb-rules'
import { isCustom, itemPolicyText } from '../prefs-rules'

defineProps<{
  tracked: AutograbSeries[]
  untracked: AutograbSeries[]
  /** 剧 id → 待处理集数 */
  pending: ReadonlyMap<number, number>
  /** 正在设置的剧 id */
  busy: ReadonlySet<number>
}>()
const emit = defineEmits<{
  open: [seriesId: number]
  track: [series: AutograbSeries]
}>()

/** 一行的说明：跟随 · 全自动 · 下一集 11月3日 */
function describe(series: AutograbSeries): string {
  return [
    itemPolicyText(isCustom(series.mode, series.prefs), series.effectiveMode),
    nextAirText(series),
  ]
    .filter(Boolean)
    .join(' · ')
}
</script>

<style scoped src="./autograb-view.css"></style>
