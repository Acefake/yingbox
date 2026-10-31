<template>
  <ul ref="root" class="ag-eps">
    <li
      v-for="ep in episodes"
      :key="ep.key"
      class="ag-ep"
      :class="{ 'is-focus': ep.key === focusKey }"
      :data-key="ep.key"
    >
      <div class="ag-ep-head">
        <span class="ag-ep-name">
          <template v-if="showSeries">{{ ep.seriesTitle }} · </template
          >{{ episodeCode(ep) }}
        </span>
        <span class="ag-ep-date">{{ monthDayText(ep.airDate) }}</span>
        <span
          v-if="ep.status !== 'found'"
          class="ag-ep-status"
          :data-status="ep.status"
        >
          {{ STATUS_LABEL[ep.status] }}
        </span>
        <span class="ag-ep-actions">
          <UiButton
            v-if="RETRYABLE.has(ep.status)"
            class="ag-quiet"
            size="sm"
            variant="plain"
            label="重新搜"
            :loading="busy.get(ep.key) === 'retry'"
            @click="emit('retry', ep.key)"
          />
          <UiButton
            v-if="SKIPPABLE.has(ep.status)"
            class="ag-quiet"
            size="sm"
            variant="plain"
            label="跳过"
            :loading="busy.get(ep.key) === 'skip'"
            @click="emit('skip', ep.key)"
          />
          <UiButton
            v-if="ep.revertable"
            class="ag-quiet"
            size="sm"
            variant="plain"
            label="撤销"
            :loading="busy.get(ep.key) === 'revert'"
            @click="revert(ep)"
          />
        </span>
      </div>
      <p
        v-if="episodeNote(ep)"
        class="ag-ep-note"
        :class="{ 'is-problem': PROBLEM.has(ep.status) }"
      >
        {{ episodeNote(ep) }}
      </p>
      <ul v-if="WITH_CANDIDATES.has(ep.status)" class="ag-cands">
        <li
          v-for="(cand, index) in shownCandidates(ep)"
          :key="cand.fileId"
          class="ag-cand"
        >
          <div class="ag-cand-main">
            <span class="ag-cand-file" :title="cand.fileName">
              {{ cand.fileName }}
            </span>
            <span class="ag-cand-meta">
              <UiSpecBadge
                v-for="spec in specsOf(cand)"
                :key="`${spec.variant}:${spec.text}`"
                v-bind="spec"
              />
              <span>{{ sizeText(cand.size) }}</span>
              <span v-tooltip="cand.reasons.join(' · ')">
                匹配 {{ cand.score }}
              </span>
            </span>
            <span class="ag-cand-source" :title="cand.shareTitle">
              来自「{{ cand.shareTitle }}」
            </span>
          </div>
          <UiButton
            size="sm"
            :variant="index === 0 ? 'primary' : 'secondary'"
            label="转存"
            :loading="busy.get(ep.key) === 'grab'"
            @click="emit('grab', ep.key, index)"
          />
        </li>
        <li v-if="hiddenCount(ep)" class="ag-cand-more">
          <UiButton
            class="ag-quiet"
            size="sm"
            variant="plain"
            icon="chevronDown"
            :label="`其它 ${hiddenCount(ep)} 个候选`"
            @click="expanded.add(ep.key)"
          />
        </li>
      </ul>
    </li>
  </ul>
</template>

<script setup lang="ts">
/**
 * 追更各集的列表（待处理、记录、侧拉面板共用，放在 SettingsGroup 里，行距与分隔线同 SettingsRow）：一集一行，行头是集号、播出日、状态（待确认不标，列表本身已说明）
 * 与次要操作（重新搜、跳过、撤销，灰色文字按钮）；有资源时列出候选：文件名、规格标签、体积、匹配分（悬停看理由）、
 * 来源分享，最佳候选的「转存」是本行唯一的主按钮。
 * showSeries 为 false 时行头不重复剧名（已按剧分组或在剧的侧板里）；bestOnly 时每集只露最佳候选（其它折叠）；
 * busy 是正在操作的集和操作（被点的那个按钮转圈并拦住重复点）；focusKey 指向的一集高亮并滚到可见处。
 */
import { nextTick, reactive, ref, watch } from 'vue'

import { confirmDialog } from '@/components/ui'
import { type SpecBadge, releaseSpecs } from '@/components/ui/spec-badge'
import { vTooltip } from '@/components/ui/tooltip'
import UiButton from '@/components/ui/UiButton.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'
import type {
  AutograbCandidate,
  AutograbEpisode,
  AutograbStatus,
} from '../../../../../shared/contract/autograb'

import {
  STATUS_LABEL,
  episodeCode,
  episodeNote,
  monthDayText,
  sizeText,
} from '../autograb-rules'
import type { EpisodeAction } from '../use-autograb'

const RETRYABLE = new Set<AutograbStatus>([
  'waiting',
  'found',
  'notFound',
  'skipped',
  'noSpace',
])
const SKIPPABLE = new Set<AutograbStatus>(['waiting', 'found', 'noSpace'])
const WITH_CANDIDATES = new Set<AutograbStatus>(['found', 'noSpace'])
/** 说明要标成问题的状态 */
const PROBLEM = new Set<AutograbStatus>(['noSpace', 'notFound'])

const props = withDefaults(
  defineProps<{
    episodes: AutograbEpisode[]
    focusKey?: string | null
    bestOnly?: boolean
    showSeries?: boolean
    busy?: ReadonlyMap<string, EpisodeAction>
  }>(),
  {
    focusKey: null,
    bestOnly: false,
    showSeries: true,
    busy: () => new Map<string, EpisodeAction>(),
  }
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

/** 候选的规格标签：从文件名和分享标题认（4K、杜比视界、HDR、中字……） */
function specsOf(cand: AutograbCandidate): SpecBadge[] {
  return releaseSpecs([cand.fileName, cand.shareTitle])
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
.ag-eps {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ag-ep {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  transition: background-color var(--duration-normal) var(--ease-out);
}

/* 同 SettingsRow 的内缩分隔线：放进 SettingsGroup 就和设置行一个样 */
.ag-ep + .ag-ep::before {
  position: absolute;
  top: 0;
  right: 0;
  left: var(--space-4);
  height: 1px;
  background: var(--separator);
  content: '';
}

.ag-ep.is-focus {
  background: var(--bg-active-soft);
}

.ag-ep-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--space-7);
}

.ag-ep-name {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.ag-ep-date {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.ag-ep-status {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.ag-ep-status[data-status='noSpace'],
.ag-ep-status[data-status='notFound'] {
  color: var(--warning);
}

.ag-ep-status[data-status='saved'],
.ag-ep-status[data-status='done'] {
  color: var(--success);
}

.ag-ep-actions {
  display: flex;
  gap: var(--space-1);
  margin-left: auto;
}

.ag-quiet.ui-button {
  color: var(--text-secondary);
}

.ag-quiet.ui-button:hover:not(:disabled) {
  background: var(--bg-fill-secondary);
  color: var(--text-primary);
}

.ag-ep-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.ag-ep-note.is-problem {
  color: var(--warning);
}

.ag-cands {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ag-cand {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.ag-cand-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.ag-cand-file,
.ag-cand-source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ag-cand-file {
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.ag-cand-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.ag-cand-source {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.ag-cand-more {
  margin-left: calc(var(--space-2) * -1);
}
</style>
