<template>
  <article class="ag-task">
    <div class="ag-task-top">
      <slot name="media">
        <GrabPoster :src="poster ?? null" :title="title" size="lg" />
      </slot>
      <div class="ag-task-copy">
        <h4 class="ag-task-title" :title="title">{{ title }}</h4>
        <span v-if="subtitle" class="ag-task-sub">{{ subtitle }}</span>
        <span class="ag-task-state" :data-tone="tone">{{ state }}</span>
      </div>
    </div>

    <div v-if="candidate" class="ag-task-res">
      <span class="ag-task-file" :title="candidate.fileName">{{
        candidate.fileName
      }}</span>
      <span class="ag-task-specs">
        <UiSpecBadge
          v-for="spec in specs"
          :key="`${spec.variant}:${spec.text}`"
          v-bind="spec"
        />
        <span v-tooltip="candidate.reasons.join(' · ')" class="ag-task-score"
          >{{ sizeText(candidate.size) }} · 匹配 {{ candidate.score }}</span
        >
      </span>
    </div>

    <p v-if="reason" class="ag-task-why">{{ reason }}</p>
    <slot />

    <div class="ag-task-act">
      <slot name="actions" />
    </div>
  </article>
</template>

<script setup lang="ts">
/**
 * 「需要你处理」的一张卡（剧集、电影、洗版共用）：左边小海报（或 media 插槽），右边标题、一行说明、状态圆点；
 * 有候选时露出最佳那一个（文件名、规格标签、体积与匹配分，悬停看加分理由），下面一句为什么要你处理；
 * 底部操作由 actions 插槽给（约定：次要操作在左，用 class="ag-quiet" 的 plain 按钮，唯一的主操作在最右）。
 */
import { computed } from 'vue'

import { type SpecBadge, releaseSpecs } from '@/components/ui/spec-badge'
import { vTooltip } from '@/components/ui/tooltip'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'

import { sizeText } from '../autograb-rules'
import GrabPoster from './GrabPoster.vue'

/** 卡片上露出的候选（剧集、电影、洗版的候选都有这几项） */
export interface TaskCandidate {
  fileName: string
  shareTitle: string
  size: number
  score: number
  reasons: string[]
}

const props = defineProps<{
  title: string
  subtitle?: string
  /** 已换好的海报地址；用 media 插槽时不必给 */
  poster?: string | null
  /** 状态字（待确认 / 找不到 / 有更清楚的……） */
  state: string
  /** pending：等你确认（强调色）；problem：出了问题（警示色） */
  tone: 'pending' | 'problem'
  candidate?: TaskCandidate | null
  reason?: string
}>()

const specs = computed<SpecBadge[]>(() =>
  props.candidate
    ? releaseSpecs([
        props.candidate.fileName,
        props.candidate.shareTitle,
      ]).slice(0, 4)
    : []
)
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

.ag-task-sub {
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

/* 插槽里的按钮属于使用方的作用域，这里用 :slotted 统一次要按钮的颜色 */
.ag-task-act :slotted(.ag-quiet.ui-button) {
  color: var(--text-secondary);
}

.ag-task-act :slotted(.ag-quiet.ui-button:hover:not(:disabled)) {
  background: var(--bg-fill-secondary);
  color: var(--text-primary);
}

.ag-task-act :slotted(.ag-grow) {
  flex: 1;
}
</style>
