<template>
  <GrabSheet
    :open="movie !== null"
    :title="movie?.title ?? ''"
    :subtitle="subtitle"
    hero
    :image="poster"
    @close="emit('close')"
  >
    <template v-if="movie && overview">
      <p v-if="note" class="mg-note">{{ note }}</p>

      <section class="mg-block" aria-labelledby="mg-mode-title">
        <h3 id="mg-mode-title" class="mg-label">追更方式</h3>
        <UiSegmented
          class="mg-modes"
          :model-value="movie.effectiveMode"
          :options="MOVIE_MODE_OPTIONS"
          :label="`${movie.title} 的追更方式`"
          @update:model-value="setMode"
        />
        <p class="mg-hint">
          {{ movie.mode === 'inherit' ? '跟随全局' : '单独设的方式' }}
        </p>
      </section>

      <SettingsGroup>
        <SettingsRow
          title="资源偏好"
          :description="overrideSummary(movie.prefs) || '跟随全局'"
        >
          <UiButton
            size="sm"
            :label="Object.keys(movie.prefs).length ? '修改' : '单独设'"
            @click="editing = true"
          />
        </SettingsRow>
      </SettingsGroup>
      <GrabOverrideForm
        v-if="editing"
        :title="`${movie.title} 单独设`"
        :mode-options="MOVIE_MODE_OPTIONS"
        :initial-mode="movie.effectiveMode"
        :value="movie.prefs"
        :inherit="overview.policy.prefs"
        @save="savePrefs"
        @cancel="editing = false"
      />

      <SettingsGroup
        v-if="movie.status === 'found' && movie.candidates.length"
        title="候选"
      >
        <SettingsRow
          v-for="(cand, index) in movie.candidates"
          :key="cand.fileId"
          :title="cand.fileName"
          :description="candidateMeta(cand)"
        >
          <UiButton
            size="sm"
            :variant="index === 0 ? 'primary' : 'secondary'"
            label="转存"
            :loading="busy === index"
            :disabled="busy !== null && busy !== index"
            @click="grab(index)"
          />
        </SettingsRow>
      </SettingsGroup>
    </template>

    <template v-if="movie" #footer>
      <UiButton
        v-if="isCustom(movie.mode, movie.prefs)"
        class="ag-quiet"
        size="sm"
        variant="plain"
        label="恢复跟随全局"
        @click="follow"
      />
      <UiButton
        v-if="RETRYABLE.has(movie.status)"
        class="ag-quiet"
        size="sm"
        variant="plain"
        label="重新搜"
        @click="retry"
      />
      <span class="mg-grow" />
      <UiButton
        class="gp-danger"
        size="sm"
        variant="plain"
        label="不再追踪"
        @click="untrack"
      />
    </template>
  </GrabSheet>
</template>

<script setup lang="ts">
/**
 * 一部电影的追踪侧板（电影栏海报墙点开）：海报头写片名、年份与状态；下面是进度说明（movieNote）、
 * 方式分段（待确认 / 全自动，选了即按这部电影单独设）、资源偏好（单独设展开表单）、有资源时的候选（第一个是主按钮）；
 * 底部操作条：重新搜、不再追踪。全自动而转存目标是根目录时主进程会拒绝并提示。
 */
import { computed, ref, watch } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import {
  GrabOverrideForm,
  GrabSheet,
  MOVIE_MODE_OPTIONS,
  isCustom,
  overrideSummary,
} from '@/features/autograb'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import { thumbSrc } from '@/services/thumbnails'
import type {
  MovieTrackStatus,
  MoviesOverview,
  TrackedMovie,
} from '../../../../../shared/contract/autograb-upgrade'
import type { GrabMode } from '../../../../../shared/contract/grab-policy'
import type { GrabPrefsOverride } from '../../../../../shared/contract/grab-prefs'

import { moviesApi } from '../api'
import { MOVIE_STATUS_LABEL, candidateMeta, movieNote } from '../upgrade-rules'

const RETRYABLE = new Set<MovieTrackStatus>(['searching', 'found', 'notFound'])

const props = defineProps<{
  movie: TrackedMovie | null
  overview: MoviesOverview | null
  /** 操作结果：失败提示原因，成功刷新总览 */
  report: (
    result: { ok: true } | { ok: false; error: string },
    success?: string
  ) => boolean
  refresh: () => void
}>()
const emit = defineEmits<{ close: [] }>()

const editing = ref(false)
const busy = ref<number | null>(null)
watch(
  () => props.movie?.tmdbId,
  () => {
    editing.value = false
    busy.value = null
  }
)

const poster = computed(() =>
  props.movie?.poster ? thumbSrc(props.movie.poster, 300) : null
)
const subtitle = computed(() => {
  const m = props.movie
  if (!m) return ''
  return [m.year ? String(m.year) : '', MOVIE_STATUS_LABEL[m.status]]
    .filter(Boolean)
    .join(' · ')
})
const note = computed(() => (props.movie ? movieNote(props.movie) : ''))

async function setMode(mode: GrabMode): Promise<void> {
  const m = props.movie
  if (!m || mode === m.effectiveMode || mode === 'off') return
  props.report(await moviesApi().setMode(m.tmdbId, mode))
}

async function savePrefs(result: {
  mode: GrabMode
  prefs: GrabPrefsOverride
}): Promise<void> {
  const m = props.movie
  if (!m) return
  if (!props.report(await moviesApi().setPrefs(m.tmdbId, result.prefs))) return
  editing.value = false
  // 电影的方式选项里没有「不追」
  const mode = result.mode === 'off' ? 'confirm' : result.mode
  if (mode !== m.mode) props.report(await moviesApi().setMode(m.tmdbId, mode))
}

async function grab(index: number): Promise<void> {
  const m = props.movie
  if (!m || busy.value !== null) return
  busy.value = index
  try {
    props.report(await moviesApi().grab(m.tmdbId, index), '已转存，等待入库')
  } finally {
    busy.value = null
  }
}

/** 跟随全局：清掉覆盖项，方式设回跟随 */
async function follow(): Promise<void> {
  const m = props.movie
  if (!m) return
  editing.value = false
  if (Object.keys(m.prefs).length)
    props.report(await moviesApi().setPrefs(m.tmdbId, {}))
  if (m.mode !== 'inherit')
    props.report(await moviesApi().setMode(m.tmdbId, 'inherit'))
}

async function retry(): Promise<void> {
  if (!props.movie) return
  await moviesApi().retry(props.movie.tmdbId)
  props.refresh()
}

async function untrack(): Promise<void> {
  if (!props.movie) return
  await moviesApi().untrack(props.movie.tmdbId)
  emit('close')
  props.refresh()
}
</script>

<style scoped src="./grab-panel.css"></style>
<style scoped>
.mg-note {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.mg-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mg-label {
  margin: 0;
  padding: 0 var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}

.mg-modes {
  align-self: flex-start;
}

.mg-hint {
  margin: 0;
  padding: 0 var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.mg-grow {
  flex: 1;
}
</style>
