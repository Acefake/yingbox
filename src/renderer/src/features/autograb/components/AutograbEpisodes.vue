<template>
  <div ref="root" class="autograb-eps">
    <h3 v-if="title" class="autograb-eps-title">{{ title }}</h3>
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
          :disabled="busy.has(ep.key)"
          @click="emit('retry', ep.key)"
        />
        <UiButton
          v-if="SKIPPABLE.has(ep.status)"
          size="sm"
          variant="plain"
          label="跳过"
          :disabled="busy.has(ep.key)"
          @click="emit('skip', ep.key)"
        />
        <UiButton
          v-if="ep.revertable"
          size="sm"
          variant="plain"
          label="撤销"
          :disabled="busy.has(ep.key)"
          @click="revert(ep)"
        />
      </div>
      <p v-if="episodeNote(ep)" class="autograb-ep-note">
        {{ episodeNote(ep) }}
      </p>
      <ul v-if="WITH_CANDIDATES.has(ep.status)" class="autograb-cands">
        <li
          v-for="(cand, index) in shownCandidates(ep)"
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
            :variant="index === 0 ? 'primary' : 'plain'"
            label="转存"
            :loading="busy.has(ep.key)"
            @click="emit('grab', ep.key, index)"
          />
        </li>
        <li v-if="hiddenCount(ep)" class="autograb-cand-more">
          <UiButton
            size="sm"
            variant="plain"
            :label="`其它 ${hiddenCount(ep)} 个候选`"
            @click="expanded.add(ep.key)"
          />
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 追更各集的状态（待处理、记录、日历侧板共用）：有资源时列出候选（文件名、分数、体积、加分理由、来源分享），点「转存」只存那一个文件；
 * 等待中的显示下次搜索时间，失败的显示原因；可重新搜、跳过；已转存的可撤销（确认后删 115 上那个文件）。
 * focusKey 指向的一集高亮并滚到可见处；bestOnly 时每集只露最佳候选（其它折叠）；
 * busy 是正在操作的集（转存 / 撤销 / 跳过 / 重搜期间按钮转圈或禁用，防重复点）。
 */
import { nextTick, reactive, ref, watch } from 'vue'

import { confirmDialog } from '@/components/ui'
import UiButton from '@/components/ui/UiButton.vue'
import type {
  AutograbCandidate,
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

const props = withDefaults(
  defineProps<{
    episodes: AutograbEpisode[]
    title?: string
    focusKey?: string | null
    bestOnly?: boolean
    busy?: ReadonlySet<string>
  }>(),
  { title: '', focusKey: null, bestOnly: false, busy: () => new Set<string>() }
)
const emit = defineEmits<{
  grab: [key: string, index: number]
  revert: [key: string]
  skip: [key: string]
  retry: [key: string]
}>()

/** 展开了全部候选的集 */
const expanded = reactive(new Set<string>())
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

/** 这一集现在列出的候选（只看最佳时没展开的只有第一个） */
function shownCandidates(ep: AutograbEpisode): AutograbCandidate[] {
  return props.bestOnly && !expanded.has(ep.key)
    ? ep.candidates.slice(0, 1)
    : ep.candidates
}

/** 被折叠的候选数 */
function hiddenCount(ep: AutograbEpisode): number {
  return ep.candidates.length - shownCandidates(ep).length
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
