<template>
  <article class="match-candidate">
    <div class="match-poster">
      <img
        v-if="candidate.poster"
        :src="candidate.poster"
        alt=""
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
      />
      <span v-else class="match-poster-empty">无海报</span>
      <span class="match-key">{{ index + 1 }}</span>
    </div>
    <div class="match-candidate-body">
      <h3 class="match-candidate-title">{{ candidate.title }}</h3>
      <p class="match-candidate-sub">
        <span v-if="candidate.source === 'ai'" class="match-ai">AI 推断</span>
        <span v-if="candidate.year">{{ candidate.year }}</span>
        <span
          v-if="
            candidate.originalTitle &&
            candidate.originalTitle !== candidate.title
          "
          >{{ candidate.originalTitle }}</span
        >
      </p>
      <div
        class="match-confidence"
        :class="confidenceClass(candidate.confidence)"
      >
        <span
          class="match-confidence-bar"
          :style="{ width: formatConfidence(candidate.confidence) }"
        />
        <span class="match-confidence-text"
          >置信度 {{ formatConfidence(candidate.confidence) }}</span
        >
      </div>
      <p v-if="candidate.overview" class="match-overview">
        {{ candidate.overview }}
      </p>
      <p v-else class="match-overview is-empty">没有简介</p>
      <UiButton
        class="match-adopt"
        :variant="index === 0 ? 'primary' : 'secondary'"
        size="sm"
        label="采用"
        :loading="busy === `adopt:${candidate.id}`"
        :disabled="busy !== null"
        @click="emit('adopt', candidate)"
      />
    </div>
  </article>
</template>

<script setup lang="ts">
/** 一个候选卡片：海报与数字键、标题 / 年份 / 原名、置信度条、简介摘要、采用按钮。 */
import type { MatchCandidateInfo } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'

import { formatConfidence } from '../shared/format'
import { confidenceClass } from './match-rules'

defineProps<{
  candidate: MatchCandidateInfo
  /** 第几个候选（0 起；第一个用主按钮）。 */
  index: number
  /** 面板当前的忙碌标记（adopt:<id> / search / lock …），null 表示空闲。 */
  busy: string | null
}>()

const emit = defineEmits<{ adopt: [candidate: MatchCandidateInfo] }>()
</script>

<style scoped>
.match-candidate {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}
.match-poster {
  position: relative;
  aspect-ratio: 2 / 3;
  max-height: 260px;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
  box-shadow: var(--shadow-sm);
}
.match-poster img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.match-poster-empty {
  display: grid;
  height: 100%;
  place-items: center;
  color: var(--text-quaternary);
  font-size: var(--text-xs);
}
.match-key {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: var(--radius-xs);
  background: var(--overlay-scrim);
  color: var(--media-text);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
}
.match-candidate-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}
.match-candidate-title {
  margin: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-candidate-sub {
  display: flex;
  gap: var(--space-2);
  margin: 0;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.match-confidence {
  position: relative;
  height: 18px;
  overflow: hidden;
  border-radius: var(--radius-xs);
  background: var(--bg-fill-secondary);
}
.match-confidence-bar {
  position: absolute;
  inset: 0 auto 0 0;
  opacity: 0.28;
}
.match-confidence.is-high .match-confidence-bar {
  background: var(--success);
}
.match-confidence.is-mid .match-confidence-bar {
  background: var(--warning);
}
.match-confidence.is-low .match-confidence-bar {
  background: var(--danger);
}
.match-confidence-text {
  position: relative;
  padding: 0 var(--space-2);
  color: var(--text-secondary);
  font-size: var(--text-2xs);
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.match-overview {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  line-clamp: 4;
}
.match-overview.is-empty {
  color: var(--text-quaternary);
}
.match-adopt {
  align-self: flex-start;
  margin-top: auto;
}
.match-ai {
  color: var(--accent-text);
  font-weight: var(--font-weight-medium);
}
</style>
