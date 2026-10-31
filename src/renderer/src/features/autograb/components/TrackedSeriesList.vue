<template>
  <section class="tracked" aria-label="在追的剧">
    <h3 class="tracked-title">在追的剧</h3>
    <ul v-if="tracked.length" class="tracked-list">
      <li v-for="series in tracked" :key="series.seriesId">
        <UiListRow @click="emit('open', series.seriesId)">
          {{ series.title }}
          <template #description>
            {{ describe(series) }}
          </template>
          <template #trailing>
            <UiIcon name="forward" size="sm" />
          </template>
        </UiListRow>
      </li>
    </ul>
    <p v-else class="tracked-empty">还没有在追的剧</p>

    <template v-if="untracked.length">
      <h3 class="tracked-title">没在追的连载剧</h3>
      <ul class="tracked-list">
        <li
          v-for="series in untracked"
          :key="series.seriesId"
          class="tracked-off"
        >
          <span class="tracked-off-name">
            {{ series.title }}
            <span v-if="nextAirText(series)" class="tracked-off-meta">
              {{ nextAirText(series) }}
            </span>
          </span>
          <UiButton
            size="sm"
            variant="plain"
            label="追更"
            :loading="busy.has(series.seriesId)"
            @click="emit('track', series)"
          />
        </li>
      </ul>
    </template>
  </section>
</template>

<script setup lang="ts">
/**
 * 自动追更页「在追的剧」：每部一行（剧名、生效方式、下一集播出日），点行打开这部剧的侧板；
 * 下面是在播或即将开播但没在追的连载剧，一键「追更」（先按待确认追，要全自动再进侧板改）。
 */
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiListRow from '@/components/ui/UiListRow.vue'
import type { AutograbSeries } from '../../../../../shared/contract/autograb'

import { nextAirText } from '../autograb-rules'
import { isCustom, itemPolicyText } from '../prefs-rules'

defineProps<{
  tracked: AutograbSeries[]
  untracked: AutograbSeries[]
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

<style scoped>
.tracked {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.tracked-title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
}

.tracked-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tracked-empty {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.tracked-off {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.tracked-off-meta {
  margin-left: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
