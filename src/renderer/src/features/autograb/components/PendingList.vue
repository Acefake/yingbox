<template>
  <section class="ag-section" aria-labelledby="ag-pending-title">
    <div class="ag-section-head">
      <h3 id="ag-pending-title" class="ag-section-title">
        需要你处理<span class="ag-section-count">{{ episodes.length }} 集</span>
      </h3>
      <UiButton
        v-if="grabbable.length > 1"
        class="ag-section-action"
        size="sm"
        variant="plain"
        icon="download"
        :label="`全部转存推荐资源（${grabbable.length}）`"
        :loading="grabbingAll"
        @click="grabAll"
      />
    </div>
    <ul class="ag-tasks">
      <li v-for="ep in episodes" :key="ep.key">
        <PendingCard
          :episode="ep"
          :series="series.get(ep.seriesId)"
          :poster="libraryImage(posters.get(ep.seriesId) ?? null, 300)"
          :busy="busy.get(ep.key)"
          @grab="(key, index) => emit('grab', key, index)"
          @skip="key => emit('skip', key)"
          @retry="key => emit('retry', key)"
          @open="key => emit('open', key)"
        />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
/**
 * 自动追更页「需要你处理」：要用户动手的集（有候选待确认、空间不足、找不到），一集一张卡（PendingCard），
 * 卡片网格自适应列数；有两集以上可以直接转存时，标题右侧「全部转存推荐资源」一次转存各集的最佳候选。
 */
import { computed } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import { libraryImage } from '@/features/library'
import type {
  AutograbEpisode,
  AutograbSeries,
} from '../../../../../shared/contract/autograb'

import type { EpisodeAction } from '../use-autograb'
import PendingCard from './PendingCard.vue'

const props = defineProps<{
  episodes: AutograbEpisode[]
  busy: ReadonlyMap<string, EpisodeAction>
  /** 剧 id → 海报（片库条目的 poster 原样） */
  posters: ReadonlyMap<number, string | null>
  /** 剧 id → 剧（说明为什么要处理） */
  series: ReadonlyMap<number, AutograbSeries>
  /** 「全部转存」进行中 */
  grabbingAll: boolean
}>()
const emit = defineEmits<{
  grab: [key: string, index: number]
  'grab-best': [keys: string[]]
  skip: [key: string]
  retry: [key: string]
  open: [key: string]
}>()

/** 有候选、等用户确认的集（「全部转存」的范围） */
const grabbable = computed(() =>
  props.episodes.filter(ep => ep.status === 'found' && ep.candidates.length > 0)
)

function grabAll(): void {
  emit(
    'grab-best',
    grabbable.value.map(ep => ep.key)
  )
}
</script>

<style scoped src="./autograb-view.css"></style>
