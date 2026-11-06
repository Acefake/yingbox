<template>
  <SettingsGroup title="合集优先">
    <SettingsRow :title="progress.title" :description="progress.description">
      <UiLoadingDots v-if="progress.busy" />
    </SettingsRow>
    <SettingsRow title="分集进度" :description="counts" />
  </SettingsGroup>
</template>

<script setup lang="ts">
/** 追剧的合集阶段与当前总览中分集记录的计数。 */
import { computed } from 'vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import type {
  AutograbEpisode,
  AutograbOverview,
  AutograbSeries,
} from '../../../../../shared/contract/autograb'
import { seriesProgress } from '../series-progress'

const props = defineProps<{
  data: AutograbOverview
  series: AutograbSeries
  episodes: AutograbEpisode[]
}>()
const progress = computed(() => seriesProgress(props.data, props.series))
const counts = computed(() => {
  const count = (status: AutograbEpisode['status']): number =>
    props.episodes.filter(ep => ep.status === status).length
  return `当前记录：已入库 ${count('done')} 集 · 已转存 ${count('saved')} 集 · 有候选 ${count('found')} 集 · 待补搜 ${count('waiting')} 集`
})
</script>
