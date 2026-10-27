<template>
  <section class="grab-panel" aria-label="电影上线追踪">
    <header class="grab-head">
      <div class="grab-head-text">
        <h2 class="grab-title">电影上线</h2>
        <p class="grab-sub">
          数字发行后每天搜一次 WEB-DL / BluRay，30 天为止{{
            policyText ? `；没单独设的电影：${policyText}` : ''
          }}
        </p>
      </div>
      <TargetFolderPill
        v-if="data"
        v-bind="folderPill"
        size="sm"
        variant="plain"
        align="right"
        :disabled="!data.ready.loggedIn"
        @pick="pickFolder"
      />
      <UiButton
        size="sm"
        variant="plain"
        icon="settings"
        label="策略"
        @click="openAutograbSettings('movie')"
      />
      <UiButton
        size="sm"
        variant="plain"
        icon="refresh"
        label="立即检查"
        :loading="data?.running"
        @click="runNow"
      />
    </header>

    <p v-if="ov.error.value" class="grab-notice">{{ ov.error.value }}</p>
    <p v-else-if="data && moviesNotice(data)" class="grab-notice">
      {{ moviesNotice(data) }}
    </p>

    <form class="movies-search" @submit.prevent="search(query)">
      <UiInput
        v-model="query"
        size="sm"
        icon="search"
        placeholder="搜电影，加入追踪"
        clearable
        :disabled="!data?.ready.tmdb"
        @clear="hits = []"
      />
    </form>
    <div v-if="suggestions.length && !hits.length" class="movies-chips">
      <span class="grab-meta">想看里的：</span>
      <UiChip
        v-for="title in suggestions"
        :key="title"
        :label="title"
        @click="search(title)"
      />
    </div>
    <ul v-if="hits.length" class="grab-list">
      <li v-for="hit in hits" :key="hit.tmdbId" class="grab-row">
        <div class="grab-row-head">
          <span class="grab-name"
            >{{ hit.title }}{{ hit.year ? ` (${hit.year})` : '' }}</span
          >
          <span v-if="tracked.has(hit.tmdbId)" class="grab-meta">已在追踪</span>
          <UiButton
            v-else
            size="sm"
            variant="primary"
            label="追踪"
            @click="track(hit.tmdbId)"
          />
        </div>
      </li>
    </ul>

    <ul v-if="data?.movies.length" class="grab-list">
      <li v-for="movie in data.movies" :key="movie.tmdbId" class="grab-row">
        <div class="grab-row-head">
          <span class="grab-name">
            {{ movie.title }}{{ movie.year ? ` (${movie.year})` : '' }}
          </span>
          <span
            class="grab-status"
            :data-tone="movie.status === 'found' ? 'accent' : undefined"
          >
            {{ MOVIE_STATUS_LABEL[movie.status] }}
          </span>
          <ItemPolicyMenu
            v-if="movie.status !== 'done'"
            :title="movie.title"
            :custom="isCustom(movie.mode, movie.prefs)"
            :effective="movie.effectiveMode"
            @follow="follow(movie)"
            @custom="editing = movie.tmdbId"
          />
          <UiButton
            v-if="movie.status === 'notFound' || movie.status === 'found'"
            size="sm"
            variant="plain"
            label="重新搜"
            @click="retry(movie.tmdbId)"
          />
          <UiIconButton
            icon="close"
            size="sm"
            :label="`不再追踪 ${movie.title}`"
            @click="untrack(movie.tmdbId)"
          />
        </div>
        <p v-if="movieNote(movie)" class="grab-meta">{{ movieNote(movie) }}</p>
        <p v-if="overrideSummary(movie.prefs)" class="grab-meta">
          单独偏好：{{ overrideSummary(movie.prefs) }}
        </p>
        <div v-if="editing === movie.tmdbId" class="grab-picker">
          <GrabOverrideForm
            :title="`${movie.title} 单独设`"
            :mode-options="MOVIE_MODE_OPTIONS"
            :initial-mode="movie.effectiveMode"
            :value="movie.prefs"
            :inherit="data.policy.prefs"
            @save="result => saveMovie(movie, result)"
            @cancel="editing = null"
          />
        </div>
        <template v-if="movie.status === 'found'">
          <div
            v-for="(cand, index) in movie.candidates"
            :key="cand.fileId"
            class="grab-cand"
          >
            <div class="grab-cand-main">
              <span class="grab-cand-file" :title="cand.fileName">{{
                cand.fileName
              }}</span>
              <span class="grab-meta">{{ candidateMeta(cand) }}</span>
            </div>
            <UiButton
              size="sm"
              variant="primary"
              label="转存"
              :loading="busy === `${movie.tmdbId}#${index}`"
              :disabled="busy !== null"
              @click="grab(movie.tmdbId, index)"
            />
          </div>
        </template>
      </li>
    </ul>
    <p v-else-if="data" class="grab-meta">
      还没有追踪的电影：在线详情页点「追踪上线」，或在上面搜一部
    </p>
  </section>
</template>

<script setup lang="ts">
/**
 * 电影上线追踪面板：转存位置胶囊（电影默认目录 / 最近使用 / 浏览 115 目录树）、「策略」跳到设置 · 自动追更、
 * TMDB 搜片加入追踪（想看清单里的片名可一键搜）；追踪中的电影显示上线日期 / 搜索进度 / 候选，
 * 每部一个「跟随 / 单独设」胶囊（单独设覆盖方式与资源偏好），可重搜、移除。
 */
import { computed, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { toast } from '@/components/ui/toast'
import {
  GrabOverrideForm,
  ItemPolicyMenu,
  MOVIE_MODE_OPTIONS,
  isCustom,
  openAutograbSettings,
  optionLabel,
  overrideSummary,
  prefsSummary,
} from '@/features/autograb'
import {
  type FolderPick,
  type FolderPreset,
  TargetFolderPill,
} from '@/features/netdisk'
import { watchlistEntries } from '@/features/watchlist'
import type {
  MovieSearchHit,
  TrackedMovie,
} from '../../../../../shared/contract/autograb-upgrade'
import type { GrabPrefsOverride } from '../../../../../shared/contract/grab-prefs'
import type { GrabMode } from '../../../../../shared/contract/grab-policy'
import {
  type TargetFolder,
  folderOf,
} from '../../../../../shared/netdisk/target-folder'

import { moviesApi } from '../api'
import {
  MOVIE_STATUS_LABEL,
  candidateMeta,
  movieNote,
  moviesNotice,
  watchlistTitles,
} from '../upgrade-rules'
import { useOverview } from '../use-overview'

const ov = useOverview(moviesApi())
const data = computed(() => ov.data.value)
const tracked = computed(() => new Set(data.value?.movies.map(m => m.tmdbId)))
const suggestions = computed(() => watchlistTitles(watchlistEntries().value))
const query = ref('')
const hits = ref<MovieSearchHit[]>([])
const busy = ref<string | null>(null)
/** 正在单独设哪部电影；null = 没有 */
const editing = ref<number | null>(null)

/** 全局策略的一句话：待确认 · 均衡 */
const policyText = computed(() => {
  const policy = data.value?.policy
  if (!policy) return ''
  return `${optionLabel(MOVIE_MODE_OPTIONS, policy.mode)} · ${prefsSummary(policy.prefs)}`
})

/** 转存位置胶囊：面板里单独选了文件夹显示它，否则是「电影默认目录」 */
const folderPill = computed<{
  folder: TargetFolder
  active: string | null
  presets: FolderPreset[]
}>(() => {
  const d = data.value
  const fallback = folderOf(
    d?.defaultFolder.cid ?? '0',
    d?.defaultFolder.name ?? ''
  )
  return {
    folder: d?.cid ? folderOf(d.cid, d.cidName) : fallback,
    active: d?.cid ? null : 'default',
    presets: [
      {
        key: 'default',
        label: '电影默认目录',
        icon: 'movie',
        folder: fallback,
      },
    ],
  }
})

async function search(text: string): Promise<void> {
  query.value = text
  if (!text.trim()) return
  try {
    hits.value = await moviesApi().search(text)
    if (!hits.value.length) toast.info('TMDB 上没搜到这部电影')
  } catch (e) {
    toast.error((e as Error).message)
  }
}

async function track(tmdbId: number): Promise<void> {
  if (ov.report(await moviesApi().track(tmdbId), '已加入追踪')) hits.value = []
}

async function untrack(tmdbId: number): Promise<void> {
  await moviesApi().untrack(tmdbId)
  ov.refresh()
}

/** 跟随全局：清掉覆盖项，方式设回跟随 */
async function follow(movie: TrackedMovie): Promise<void> {
  editing.value = null
  if (Object.keys(movie.prefs).length)
    ov.report(await moviesApi().setPrefs(movie.tmdbId, {}))
  if (movie.mode !== 'inherit')
    ov.report(await moviesApi().setMode(movie.tmdbId, 'inherit'))
}

/** 单独设：存覆盖项，方式变了再改（全自动而转存目标是根目录时主进程会拒绝并提示） */
async function saveMovie(
  movie: TrackedMovie,
  result: { mode: GrabMode; prefs: GrabPrefsOverride }
): Promise<void> {
  if (!ov.report(await moviesApi().setPrefs(movie.tmdbId, result.prefs))) return
  editing.value = null
  // 电影的方式选项里没有「不追」
  const mode = result.mode === 'off' ? 'confirm' : result.mode
  if (mode !== movie.mode)
    ov.report(await moviesApi().setMode(movie.tmdbId, mode))
}

async function retry(tmdbId: number): Promise<void> {
  await moviesApi().retry(tmdbId)
  ov.refresh()
}

async function grab(tmdbId: number, index: number): Promise<void> {
  busy.value = `${tmdbId}#${index}`
  try {
    ov.report(await moviesApi().grab(tmdbId, index), '已转存，等待入库')
  } finally {
    busy.value = null
  }
}

/** 选「电影默认目录」清掉面板里的单独文件夹；选了文件夹就存成电影追踪的位置 */
async function pickFolder(pick: FolderPick): Promise<void> {
  const folder = 'folder' in pick ? pick.folder : null
  await moviesApi().setFolder(
    folder?.cid ?? '',
    folder ? folder.name || '根目录' : ''
  )
  ov.refresh()
}

async function runNow(): Promise<void> {
  await moviesApi().runNow()
  ov.refresh()
}
</script>

<style scoped src="./grab-panel.css"></style>
<style scoped>
.movies-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
</style>
