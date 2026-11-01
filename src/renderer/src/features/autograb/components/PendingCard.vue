<template>
  <article class="ag-task" :data-key="episode.key">
    <div class="ag-task-top">
      <GrabPoster :src="poster" :title="episode.seriesTitle" size="lg" />
      <div class="ag-task-copy">
        <h4 class="ag-task-title">{{ episode.seriesTitle }}</h4>
        <span class="ag-task-ep"
          >{{ episodeCode(episode) }} ·
          {{ monthDayText(episode.airDate) }}播出</span
        >
        <span class="ag-task-state" :data-tone="tone">{{ stateText }}</span>
      </div>
    </div>

    <div v-if="best" class="ag-task-res">
      <span class="ag-task-file" :title="best.fileName">{{
        best.fileName
      }}</span>
      <span class="ag-task-specs">
        <UiSpecBadge
          v-for="spec in specs"
          :key="`${spec.variant}:${spec.text}`"
          v-bind="spec"
        />
        <span v-tooltip="best.reasons.join(' · ')" class="ag-task-score"
          >{{ sizeText(best.size) }} · 匹配 {{ best.score }}</span
        >
      </span>
    </div>

    <p class="ag-task-why">{{ reason }}</p>

    <div class="ag-task-act">
      <UiButton
        class="ag-quiet"
        size="sm"
        variant="plain"
        :label="more ? `另 ${more} 个` : '详情'"
        @click="emit('open', episode.key)"
      />
      <UiButton
        v-if="episode.status !== 'notFound'"
        class="ag-quiet"
        size="sm"
        variant="plain"
        label="跳过"
        :loading="busy === 'skip'"
        @click="emit('skip', episode.key)"
      />
      <span class="ag-task-grow" />
      <UiButton
        v-if="best && episode.status === 'found'"
        size="sm"
        variant="primary"
        icon="download"
        label="转存"
        :loading="busy === 'grab'"
        @click="emit('grab', episode.key, 0)"
      />
      <UiButton
        v-else-if="best"
        size="sm"
        icon="download"
        label="再试转存"
        :loading="busy === 'grab'"
        @click="emit('grab', episode.key, 0)"
      />
      <UiButton
        v-else
        size="sm"
        icon="refresh"
        label="现在重搜"
        :loading="busy === 'retry'"
        @click="emit('retry', episode.key)"
      />
    </div>
  </article>
</template>

<script setup lang="ts">
/**
 * 自动追更页「需要你处理」的一张卡（一集一张）：海报、剧名、集号与播出日、状态；
 * 有资源时露出最佳候选（文件名、规格标签、体积与匹配分，悬停看加分理由），下面一句为什么要你处理（pendingReason）；
 * 操作：其它候选 / 详情（打开这一集的侧板：全部候选、重新搜、撤销）、跳过，右侧是唯一的主操作——有资源「转存」，找不到「现在重搜」。
 */
import { computed } from 'vue'

import { type SpecBadge, releaseSpecs } from '@/components/ui/spec-badge'
import { vTooltip } from '@/components/ui/tooltip'
import UiButton from '@/components/ui/UiButton.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'
import type {
  AutograbEpisode,
  AutograbSeries,
} from '../../../../../shared/contract/autograb'

import {
  episodeCode,
  monthDayText,
  pendingReason,
  sizeText,
} from '../autograb-rules'
import type { EpisodeAction } from '../use-autograb'
import GrabPoster from './GrabPoster.vue'

const props = defineProps<{
  episode: AutograbEpisode
  /** 这部剧（总览里有时）：说明为什么要处理 */
  series?: AutograbSeries
  /** 已换好的海报地址 */
  poster: string | null
  /** 这一集正在进行的操作 */
  busy?: EpisodeAction
}>()
const emit = defineEmits<{
  grab: [key: string, index: number]
  skip: [key: string]
  retry: [key: string]
  open: [key: string]
}>()

const best = computed(() => props.episode.candidates[0] ?? null)
const more = computed(() => Math.max(0, props.episode.candidates.length - 1))
const specs = computed<SpecBadge[]>(() =>
  best.value
    ? releaseSpecs([best.value.fileName, best.value.shareTitle]).slice(0, 4)
    : []
)
const reason = computed(() => pendingReason(props.episode, props.series))
const tone = computed(() =>
  props.episode.status === 'found' ? 'pending' : 'problem'
)
const stateText = computed(() => {
  if (props.episode.status === 'found') return '待确认'
  return props.episode.status === 'noSpace' ? '空间不足' : '找不到'
})
</script>

<style scoped>
.ag-task {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}

.ag-task-top {
  display: flex;
  gap: var(--space-3);
  min-width: 0;
}

.ag-task-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-0_5);
  min-width: 0;
}

.ag-task-title {
  overflow: hidden;
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ag-task-ep {
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.ag-task-state {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
  margin-top: var(--space-1);
  font-size: var(--text-xs);
}

.ag-task-state::before {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: currentColor;
  content: '';
}

.ag-task-state[data-tone='pending'] {
  color: var(--accent-text);
}

.ag-task-state[data-tone='problem'] {
  color: var(--warning);
}

.ag-task-res {
  display: flex;
  flex-direction: column;
  gap: var(--space-1_5);
  padding: var(--space-2_5) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
}

.ag-task-file {
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ag-task-specs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}

.ag-task-score {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  font-variant-numeric: tabular-nums;
}

.ag-task-why {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}

.ag-task-act {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: auto;
}

.ag-task-grow {
  flex: 1;
}

.ag-quiet.ui-button {
  color: var(--text-secondary);
}

.ag-quiet.ui-button:hover:not(:disabled) {
  background: var(--bg-fill-secondary);
  color: var(--text-primary);
}
</style>
