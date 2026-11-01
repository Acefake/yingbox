<template>
  <GrabSheet
    :open="episode !== null"
    :title="title"
    :subtitle="subtitle"
    hero
    :image="image"
    @close="emit('close')"
  >
    <template v-if="episode">
      <ol class="ep-steps" aria-label="进度">
        <li
          v-for="step in steps"
          :key="step.label"
          class="ep-step"
          :data-state="step.state"
          :aria-current="step.state === 'current' ? 'step' : undefined"
        >
          {{ step.label
          }}<span class="ep-sr">（{{ STEP_STATE[step.state] }}）</span>
        </li>
      </ol>

      <p v-if="note" class="ep-note">{{ note }}</p>

      <section v-if="best" class="ep-block" aria-labelledby="ep-best-title">
        <h3 id="ep-best-title" class="ep-label">推荐资源</h3>
        <div class="ep-best">
          <span class="ep-specs">
            <UiSpecBadge
              v-for="spec in specsOf(best)"
              :key="`${spec.variant}:${spec.text}`"
              v-bind="spec"
            />
            <span v-tooltip="best.reasons.join(' · ')" class="ep-score"
              >匹配 {{ best.score }}</span
            >
          </span>
          <span class="ep-file" :title="best.fileName">{{
            best.fileName
          }}</span>
          <span class="ep-from" :title="best.shareTitle"
            >{{ sizeText(best.size) }} · 来自「{{ best.shareTitle }}」</span
          >
        </div>
      </section>

      <SettingsGroup v-if="others.length" :title="`其它 ${others.length} 个`">
        <SettingsRow
          v-for="(cand, i) in others"
          :key="cand.fileId"
          :title="cand.fileName"
          :description="`${sizeText(cand.size)} · 匹配 ${cand.score}`"
        >
          <UiButton
            size="sm"
            label="转存"
            :loading="busyGrab === i + 1"
            :disabled="busyGrab !== null"
            @click="grab(i + 1)"
          />
        </SettingsRow>
      </SettingsGroup>
    </template>

    <template v-if="episode" #footer>
      <UiButton
        v-if="SKIPPABLE.has(episode.status)"
        class="ep-quiet"
        size="sm"
        variant="plain"
        label="跳过这一集"
        :loading="ag.busy.get(episode.key) === 'skip'"
        :disabled="busyGrab !== null"
        @click="ag.skip(episode.key)"
      />
      <UiButton
        v-if="RETRYABLE.has(episode.status)"
        class="ep-quiet"
        size="sm"
        variant="plain"
        label="重新搜"
        :loading="ag.busy.get(episode.key) === 'retry'"
        :disabled="busyGrab !== null"
        @click="ag.retry(episode.key)"
      />
      <UiButton
        v-if="episode.revertable"
        class="ep-quiet"
        size="sm"
        variant="plain"
        label="撤销转存"
        :loading="ag.busy.get(episode.key) === 'revert'"
        :disabled="busyGrab !== null"
        @click="revert"
      />
      <span class="ep-grow" />
      <UiButton
        v-if="best && GRABBABLE.has(episode.status)"
        variant="primary"
        icon="download"
        label="转存推荐资源"
        :loading="busyGrab === 0"
        :disabled="busyGrab !== null && busyGrab !== 0"
        @click="grab(0)"
      />
    </template>
  </GrabSheet>
</template>

<script setup lang="ts">
/**
 * 一集的追更侧板（日历上的状态点、追更页卡片的「另 N 个」点开）：海报头写剧名、集号与播出日；
 * 下面是进度条（播出 → 搜资源 → 确认 → 转存 115 → 入库，episodeSteps），推荐资源单独一块（规格、匹配分、文件名、来源），
 * 其它候选一行一个；底部操作条：跳过、重新搜、撤销，右侧唯一的主按钮「转存推荐资源」。
 * episodeKey 是「剧 id:季:集」；总览里没有这一集（已被挤出最近 60 集）时不打开。
 */
import { computed, ref, watch } from 'vue'

import { confirmDialog } from '@/components/ui'
import { type SpecBadge, releaseSpecs } from '@/components/ui/spec-badge'
import { vTooltip } from '@/components/ui/tooltip'
import UiButton from '@/components/ui/UiButton.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'
import { libraryImage } from '@/features/library'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import type {
  AutograbCandidate,
  AutograbStatus,
} from '../../../../../shared/contract/autograb'

import {
  type EpisodeStep,
  episodeCode,
  episodeNote,
  episodeSteps,
  monthDayText,
  sizeText,
} from '../autograb-rules'
import { useAutograb } from '../use-autograb'
import { useSeriesPosters } from '../use-series-posters'
import GrabSheet from './GrabSheet.vue'

const RETRYABLE = new Set<AutograbStatus>([
  'waiting',
  'found',
  'notFound',
  'skipped',
  'noSpace',
])
const SKIPPABLE = new Set<AutograbStatus>(['waiting', 'found', 'noSpace'])
const GRABBABLE = new Set<AutograbStatus>(['found', 'noSpace'])
/** 进度格的状态给读屏的字（颜色之外） */
const STEP_STATE: Record<EpisodeStep['state'], string> = {
  done: '已完成',
  current: '进行中',
  problem: '有问题',
  todo: '未开始',
}

const props = defineProps<{ episodeKey: string | null }>()
const emit = defineEmits<{ close: [] }>()

const ag = useAutograb()
const episode = computed(
  () =>
    ag.overview.value?.episodes.find(ep => ep.key === props.episodeKey) ?? null
)
// 这一集不在总览里了（被挤出去或被清掉）：关掉，别等它回来时自己弹出
watch(
  () => [props.episodeKey, ag.overview.value, episode.value] as const,
  ([key, overview, ep]) => {
    if (key && overview && !ep) emit('close')
  }
)
const posters = useSeriesPosters(() => ag.overview.value?.series ?? [])
const image = computed(() =>
  episode.value
    ? libraryImage(posters.value.get(episode.value.seriesId) ?? null, 300)
    : null
)
const title = computed(() =>
  episode.value
    ? `${episode.value.seriesTitle} · ${episodeCode(episode.value)}`
    : '追更'
)
const subtitle = computed(() =>
  episode.value ? `${monthDayText(episode.value.airDate)} 播出` : ''
)
const steps = computed(() => (episode.value ? episodeSteps(episode.value) : []))
const note = computed(() => (episode.value ? episodeNote(episode.value) : ''))
const best = computed(() => episode.value?.candidates[0] ?? null)
const others = computed(() => episode.value?.candidates.slice(1) ?? [])

/** 正在转存的是第几个候选（只让被点的那个按钮转圈，其余候选暂时不能点） */
const busyGrab = ref<number | null>(null)

function specsOf(cand: AutograbCandidate): SpecBadge[] {
  return releaseSpecs([cand.fileName, cand.shareTitle])
}

async function grab(index: number): Promise<void> {
  if (!episode.value || busyGrab.value !== null) return
  busyGrab.value = index
  try {
    await ag.grab(episode.value.key, index)
  } finally {
    busyGrab.value = null
  }
}

async function revert(): Promise<void> {
  const ep = episode.value
  if (!ep) return
  const ok = await confirmDialog({
    title: `撤销 ${ep.seriesTitle} ${episodeCode(ep)}？`,
    content:
      '会删除追更存进 115 的那个文件（进 115 回收站），这一集回到缺集，这个候选以后不再用。媒体库里的记录在下次刷新时处理。',
    okText: '撤销',
    danger: true,
  })
  if (ok) void ag.revert(ep.key)
}
</script>

<style scoped>
.ep-steps {
  display: flex;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ep-step {
  position: relative;
  flex: 1;
  min-width: 0;
  padding-top: var(--space-3);
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ep-step::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
  content: '';
}

.ep-step[data-state='done'] {
  color: var(--text-secondary);
}

.ep-step[data-state='done']::before {
  background: var(--text-secondary);
}

.ep-step[data-state='current'] {
  color: var(--accent-text);
  font-weight: var(--font-weight-semibold);
}

.ep-step[data-state='current']::before {
  background: var(--accent);
}

.ep-step[data-state='problem'] {
  color: var(--warning);
  font-weight: var(--font-weight-semibold);
}

.ep-step[data-state='problem']::before {
  background: var(--warning);
}

.ep-note {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.ep-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.ep-label {
  margin: 0;
  padding: 0 var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}

/* 推荐资源：强调色细边圈出（焦点语义：这一步要你看的就是它） */
.ep-best {
  display: flex;
  flex-direction: column;
  gap: var(--space-1_5);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-fill-secondary));
  box-shadow: inset 0 0 0 1px var(--accent);
}

.ep-specs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}

.ep-score {
  margin-left: auto;
  color: var(--accent-text);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.ep-file,
.ep-from {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ep-file {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.ep-from {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.ep-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.ep-grow {
  flex: 1;
}

.ep-quiet.ui-button {
  color: var(--text-secondary);
}
</style>
