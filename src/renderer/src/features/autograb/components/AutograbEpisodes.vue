<template>
  <div class="autograb-eps">
    <h3 class="autograb-eps-title">最近的集</h3>
    <div v-for="ep in episodes" :key="ep.key" class="autograb-ep">
      <div class="autograb-ep-head">
        <span class="autograb-ep-name">
          {{ ep.seriesTitle }} · {{ episodeCode(ep) }}
        </span>
        <span class="autograb-ep-date">{{ ep.airDate }}</span>
        <span class="autograb-ep-status" :data-status="ep.status">
          {{ STATUS_LABEL[ep.status] }}
        </span>
        <UiButton
          v-if="
            ep.status === 'waiting' ||
            ep.status === 'found' ||
            ep.status === 'notFound' ||
            ep.status === 'skipped'
          "
          size="sm"
          variant="plain"
          label="重新搜"
          @click="emit('retry', ep.key)"
        />
        <UiButton
          v-if="ep.status === 'waiting' || ep.status === 'found'"
          size="sm"
          variant="plain"
          label="跳过"
          @click="emit('skip', ep.key)"
        />
      </div>
      <p v-if="episodeNote(ep)" class="autograb-ep-note">
        {{ episodeNote(ep) }}
      </p>
      <ul v-if="ep.status === 'found'" class="autograb-cands">
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
 * 等待中的显示下次搜索时间，失败的显示原因；可重新搜、跳过。
 */
import { ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import type { AutograbEpisode } from '../../../../../shared/contract/autograb'

import {
  STATUS_LABEL,
  episodeCode,
  episodeNote,
  sizeText,
} from '../autograb-rules'

defineProps<{ episodes: AutograbEpisode[] }>()
const emit = defineEmits<{
  grab: [key: string, index: number]
  skip: [key: string]
  retry: [key: string]
}>()

const busy = ref<string | null>(null)

function grab(key: string, index: number): void {
  busy.value = `${key}#${index}`
  emit('grab', key, index)
  // 结果由父组件提示，按钮短暂锁住防连点
  setTimeout(() => (busy.value = null), 1500)
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
