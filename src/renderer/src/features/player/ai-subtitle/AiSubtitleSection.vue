<template>
  <section class="ai-sub" aria-label="AI 字幕">
    <div class="ai-sub-head">
      <span class="ai-sub-title">
        <UiIcon name="sparkle" size="sm" />AI 生成字幕
      </span>
      <UiSegmented
        v-if="state.supported.value && !active"
        :model-value="state.mode.value"
        :options="AI_SUBTITLE_MODE_OPTIONS"
        label="输出"
        size="sm"
        @update:model-value="state.setMode"
      />
    </div>

    <p v-if="!state.supported.value" class="ai-sub-note">
      只支持本地视频文件，在线播放暂不支持
    </p>

    <template v-else-if="job && active">
      <div
        class="ai-sub-progress"
        role="progressbar"
        :aria-valuenow="overall"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuetext="statusText"
      >
        <div :style="{ transform: `scaleX(${overall / 100})` }" />
      </div>
      <div class="ai-sub-row">
        <span class="ai-sub-note">{{ statusText }}</span>
        <UiIconButton
          icon="close"
          label="取消生成"
          size="sm"
          @click="state.cancel"
        />
      </div>
    </template>

    <div v-else class="ai-sub-row">
      <span class="ai-sub-note">{{ idleText }}</span>
      <div class="ai-sub-actions">
        <UiButton
          v-if="state.existing.value"
          size="sm"
          variant="plain"
          label="加载已生成"
          @click="state.loadExisting"
        />
        <UiButton
          size="sm"
          icon="wand"
          :label="state.existing.value ? '重新生成' : '生成'"
          :loading="state.starting.value"
          @click="state.start"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 字幕面板里的「AI 生成字幕」：选输出（中文 / 双语 / 原文）→ 生成；进行中显示识别 / 翻译进度并可取消；
 * 已生成过的可直接加载。状态与操作在 useAiSubtitle，这里只负责展示。
 */
import { computed } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'

import {
  AI_SUBTITLE_MODE_OPTIONS,
  isJobActive,
  jobOverallPercent,
  jobStatusText,
} from './ai-subtitle-rules'
import type { AiSubtitleState } from './use-ai-subtitle'

const props = defineProps<{
  /** useAiSubtitle 的返回值 */
  state: AiSubtitleState
}>()

const job = computed(() => props.state.job.value)
const active = computed(() => isJobActive(job.value))
const overall = computed(() => (job.value ? jobOverallPercent(job.value) : 0))
const statusText = computed(() => (job.value ? jobStatusText(job.value) : ''))
/** 空闲时的说明：上次失败 / 取消的原因，或用法提示 */
const idleText = computed(() => {
  const last = job.value
  if (last && (last.phase === 'failed' || last.phase === 'cancelled'))
    return jobStatusText(last)
  return props.state.existing.value
    ? '这部片已有 AI 字幕'
    : '识别语音并翻译，完成后自动加载'
})
</script>

<style scoped>
.ai-sub {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.ai-sub-head,
.ai-sub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.ai-sub-title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  font-weight: 500;
}

.ai-sub-actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-1);
}

.ai-sub-note {
  min-width: 0;
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
  overflow-wrap: anywhere;
}

.ai-sub-progress {
  overflow: hidden;
  height: 3px;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
}

.ai-sub-progress > div {
  height: 100%;
  background: var(--accent);
  transform-origin: left;
  transition: transform var(--duration-slow) var(--ease-out);
}
</style>
