<template>
  <section class="ag-section" aria-labelledby="ag-pending-title">
    <h3 id="ag-pending-title" class="ag-section-title">
      待处理<span class="ag-section-count">{{ episodes.length }}</span>
    </h3>
    <SettingsGroup v-for="group in groups" :key="group.seriesId">
      <SettingsRow
        :title="group.title"
        :description="`${group.episodes.length} 集待处理`"
      >
        <template #leading>
          <GrabPoster
            :src="libraryImage(posters.get(group.seriesId) ?? null, 300)"
            :title="group.title"
            size="md"
          />
        </template>
      </SettingsRow>
      <AutograbEpisodes
        class="ag-rows-after"
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
 * 自动追更页「待处理」：要用户动手的集（有候选待确认、空间不足、找不到），按剧分组，一部剧一个玻璃分组（组头是海报、剧名和集数）；
 * 每集默认只露最佳候选和它的「转存」，其它候选折叠。
 */
import { computed } from 'vue'

import { libraryImage } from '@/features/library'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import type { AutograbEpisode } from '../../../../../shared/contract/autograb'

import { groupBySeries } from '../autograb-rules'
import type { EpisodeAction } from '../use-autograb'
import AutograbEpisodes from './AutograbEpisodes.vue'
import GrabPoster from './GrabPoster.vue'

const props = defineProps<{
  episodes: AutograbEpisode[]
  busy: ReadonlyMap<string, EpisodeAction>
  /** 剧 id → 海报（片库条目的 poster 原样） */
  posters: ReadonlyMap<number, string | null>
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
