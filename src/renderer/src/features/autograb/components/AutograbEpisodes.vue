<template>
  <div ref="root" class="autograb-eps">
    <h3 class="autograb-eps-title">最近的集</h3>
    <div
      v-for="ep in episodes"
      :key="ep.key"
      class="autograb-ep"
      :class="{ 'is-focus': ep.key === focusKey }"
      :data-key="ep.key"
    >
      <div class="autograb-ep-head">
        <span class="autograb-ep-name">
          {{ ep.seriesTitle }} · {{ episodeCode(ep) }}
        </span>
        <span class="autograb-ep-date">{{ ep.airDate }}</span>
        <span class="autograb-ep-status" :data-status="ep.status">
          {{ STATUS_LABEL[ep.status] }}
        </span>
        <UiButton
          v-if="RETRYABLE.has(ep.status)"
          size="sm"
          variant="plain"
          label="重新搜"
          @click="emit('retry', ep.key)"
        />
        <UiButton
          v-if="SKIPPABLE.has(ep.status)"
          size="sm"
          variant="plain"
          label="跳过"
          @click="emit('skip', ep.key)"
        />
        <UiButton
          v-if="ep.revertable"
          size="sm"
          variant="plain"
          label="撤销"
          @click="revert(ep)"
        />
      </div>
      <p v-if="episodeNote(ep)" class="autograb-ep-note">
        {{ episodeNote(ep) }}
      </p>
      <ul v-if="WITH_CANDIDATES.has(ep.status)" class="autograb-cands">
        <li
          v-for="(cand, index) in ep.candidates"
          :key="cand.fileId"
          class="autograb-cand"
        >
          <div class="autograb-cand-main">
            <span class="autograb-cand-file" :title="cand.fileName">
              {{ cand.fileName }}
            </span>
            <span class="autograb-cand-meta">
              {{ cand.score }} 分 · {{ sizeText(cand.size) }} ·
              {{ cand.reasons.join(' · ') }}
            </span>
            <span class="autograb-cand-meta" :title="cand.shareTitle">
              来自「{{ cand.shareTitle }}」
            </span>
          </div>
          <UiButton
            size="sm"
            variant="primary"
            label="转存"
            :loading="busy === `${ep.key}#${index}`"
            :disabled="busy !== null"
            @click="grab(ep.key, index)"
          />
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 追更面板里各集的状态：有资源时列出候选（文件名、分数、体积、加分理由、来源分享），点「转存」只存那一个文件；
 * 等待中的显示下次搜索时间，失败的显示原因；可重新搜、跳过；已转存的可撤销（确认后删 115 上那个文件）。
 * focusKey 指向的一集高亮并滚到可见处（从日历卡片的小标记点进来时）。
 */
import { nextTick, ref, watch } from 'vue'

import { confirmDialog } from '@/components/ui'
import UiButton from '@/components/ui/UiButton.vue'
import type {
  AutograbEpisode,
  AutograbStatus,
} from '../../../../../shared/contract/autograb'

import {
  STATUS_LABEL,
  episodeCode,
  episodeNote,
  sizeText,
} from '../autograb-rules'

const RETRYABLE = new Set<AutograbStatus>([
  'waiting',
  'found',
  'notFound',
  'skipped',
  'noSpace',
])
const SKIPPABLE = new Set<AutograbStatus>(['waiting', 'found', 'noSpace'])
const WITH_CANDIDATES = new Set<AutograbStatus>(['found', 'noSpace'])

const props = defineProps<{
  episodes: AutograbEpisode[]
  focusKey?: string | null
}>()
const emit = defineEmits<{
  grab: [key: string, index: number]
  revert: [key: string]
  skip: [key: string]
  retry: [key: string]
}>()

const busy = ref<string | null>(null)
const root = ref<HTMLElement | null>(null)

// 定位：focusKey 变了或列表刚加载出来时滚到那一集
watch(
  () => [props.focusKey, props.episodes.length] as const,
  async ([key]) => {
    if (!key) return
    await nextTick()
    const el = root.value?.querySelector<HTMLElement>(
      `[data-key="${CSS.escape(key)}"]`
    )
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el?.scrollIntoView({
      block: 'center',
      behavior: reduce ? 'auto' : 'smooth',
    })
  },
  { immediate: true }
)

function grab(key: string, index: number): void {
  busy.value = `${key}#${index}`
  emit('grab', key, index)
  // 结果由父组件提示，按钮短暂锁住防连点
  setTimeout(() => (busy.value = null), 1500)
}

async function revert(ep: AutograbEpisode): Promise<void> {
  const ok = await confirmDialog({
    title: `撤销 ${ep.seriesTitle} ${episodeCode(ep)}？`,
    content:
      '会删除追更存进 115 的那个文件（进 115 回收站），这一集回到缺集，这个候选以后不再用。媒体库里的记录在下次刷新时处理。',
    okText: '撤销',
    danger: true,
  })
  if (ok) emit('revert', ep.key)
}
</script>

<style scoped>
.autograb-eps {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.autograb-eps-title {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
}

.autograb-ep {
  padding: var(--space-2) 0;
  border-top: 1px solid var(--separator);
  transition: background-color var(--duration-normal) var(--ease-out);
}

.autograb-ep.is-focus {
  margin: 0 calc(-1 * var(--space-2));
  padding: var(--space-2);
  border-radius: var(--radius-md);
  background: var(--accent-soft);
}

.autograb-ep-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.autograb-ep-name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.autograb-ep-date,
.autograb-ep-note,
.autograb-cand-meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.autograb-ep-status {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.autograb-ep-status[data-status='found'] {
  color: var(--accent-text);
}

.autograb-ep-status[data-status='noSpace'] {
  color: var(--warning);
}

.autograb-ep-status[data-status='saved'],
.autograb-ep-status[data-status='done'] {
  color: var(--success);
}

.autograb-cands {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
}

.autograb-cand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
}

.autograb-cand-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.autograb-cand-file {
  overflow: hidden;
  font-size: var(--text-sm);
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
