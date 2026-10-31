<template>
  <section class="ag-section" aria-labelledby="ag-pending-title">
    <h3 id="ag-pending-title" class="ag-section-title">
      待处理<span class="ag-section-count">{{ episodes.length }}</span>
    </h3>
    <SettingsGroup
      v-for="group in groups"
      :key="group.seriesId"
      :title="group.title"
    >
      <AutograbEpisodes
        best-only
        :show-series="false"
        :episodes="group.episodes"
        :busy="busy"
        @grab="(key, index) => emit('grab', key, index)"
        @revert="key => emit('revert', key)"
        @skip="key => emit('skip', key)"
        @retry="key => emit('retry', key)"
      />
    </SettingsGroup>
  </section>
</template>

<script setup lang="ts">
/**
 * 自动追更页「待处理」：要用户动手的集（有候选待确认、空间不足、找不到），按剧分组，一部剧一个玻璃分组；
 * 每集默认只露最佳候选和它的「转存」，其它候选折叠。
 */
import { computed } from 'vue'

import { SettingsGroup } from '@/features/settings'
import type { AutograbEpisode } from '../../../../../shared/contract/autograb'

import { groupBySeries } from '../autograb-rules'
import type { EpisodeAction } from '../use-autograb'
import AutograbEpisodes from './AutograbEpisodes.vue'

const props = defineProps<{
  episodes: AutograbEpisode[]
  busy: ReadonlyMap<string, EpisodeAction>
}>()
const emit = defineEmits<{
  grab: [key: string, index: number]
  revert: [key: string]
  skip: [key: string]
  retry: [key: string]
}>()

const groups = computed(() => groupBySeries(props.episodes))
</script>

<style scoped src="./autograb-view.css"></style>
