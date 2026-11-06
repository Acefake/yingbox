<template>
  <GrabTaskCard
    class="ag-pending-card"
    :data-key="episode.key"
    :title="episode.seriesTitle"
    :subtitle="`${episodeCode(episode)} · ${monthDayText(episode.airDate)}播出`"
    :poster="poster"
    :state="stateText"
    :tone="episode.status === 'found' ? 'pending' : 'problem'"
    :candidate="best"
    :reason="reason"
  >
    <template #actions>
      <UiButton
        class="ag-quiet"
        size="sm"
        variant="plain"
        :label="more ? `另 ${more} 个` : '详情'"
        @click="emit('open', episode.key)"
      />
      <UiButton
        class="ag-quiet"
        size="sm"
        variant="plain"
        label="跳过本集"
        :loading="busy === 'skip'"
        :disabled="Boolean(busy && busy !== 'skip') || stopping"
        @click="emit('skip', episode.key)"
      />
      <UiButton
        class="ag-quiet"
        size="sm"
        variant="plain"
        label="取消追剧"
        :loading="stopping"
        @click="emit('stop', episode.seriesId)"
      />
      <span class="ag-grow" />
      <UiButton
        v-if="best && episode.status === 'found'"
        size="sm"
        variant="primary"
        icon="download"
        label="转存"
        :loading="busy === 'grab'"
        :disabled="stopping || Boolean(busy && busy !== 'grab')"
        @click="emit('grab', episode.key, 0)"
      />
      <UiButton
        v-else-if="best"
        size="sm"
        icon="download"
        label="再试转存"
        :loading="busy === 'grab'"
        :disabled="stopping || Boolean(busy && busy !== 'grab')"
        @click="emit('grab', episode.key, 0)"
      />
      <UiButton
        v-else
        size="sm"
        icon="refresh"
        label="现在重搜"
        :loading="busy === 'retry'"
        :disabled="stopping || Boolean(busy && busy !== 'retry')"
        @click="emit('retry', episode.key)"
      />
    </template>
  </GrabTaskCard>
</template>

<script setup lang="ts">
/**
 * 自动追更页「需要你处理」里剧集的一张卡（一集一张，外观见 GrabTaskCard）：说明为什么要你处理（pendingReason）；
 * 操作：其它候选 / 详情（打开这一集的侧板：全部候选、重新搜、撤销）、跳过，
 * 右侧是唯一的主操作——有资源「转存」，找不到「现在重搜」。
 */
import { computed } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import type {
  AutograbEpisode,
  AutograbSeries,
} from '../../../../../shared/contract/autograb'

import { episodeCode, monthDayText, pendingReason } from '../autograb-rules'
import type { EpisodeAction } from '../use-autograb'
import GrabTaskCard from './GrabTaskCard.vue'

const props = defineProps<{
  episode: AutograbEpisode
  /** 这部剧（总览里有时）：说明为什么要处理 */
  series?: AutograbSeries
  /** 已换好的海报地址 */
  poster: string | null
  /** 这一集正在进行的操作 */
  busy?: EpisodeAction
  /** 整部剧正在确认或取消追更。 */
  stopping?: boolean
}>()
const emit = defineEmits<{
  grab: [key: string, index: number]
  skip: [key: string]
  retry: [key: string]
  open: [key: string]
  stop: [seriesId: number]
}>()

const best = computed(() => props.episode.candidates[0] ?? null)
const more = computed(() => Math.max(0, props.episode.candidates.length - 1))
const reason = computed(() => pendingReason(props.episode, props.series))
const stateText = computed(() => {
  if (props.episode.status === 'found') return '待确认'
  return props.episode.status === 'noSpace' ? '空间不足' : '找不到'
})
</script>

<style scoped>
.ag-pending-card :deep(.ag-task-act) {
  flex-wrap: wrap;
}
</style>
