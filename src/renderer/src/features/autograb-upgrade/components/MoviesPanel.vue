<template>
  <div class="gp-view">
    <header class="gp-toolbar">
      <p class="gp-state">
        <span class="gp-dot is-on" aria-hidden="true" />
        <span role="status" aria-live="polite">{{
          data ? moviesStatusLine(data) : '正在读取电影追踪'
        }}</span>
        <UiLoadingDots v-if="!data || data.running" />
      </p>
      <TargetFolderPill
        v-if="data"
        v-bind="folderPill"
        :disabled="!data.ready.loggedIn"
        @pick="pickFolder"
      />
      <UiButton
        icon="settings"
        :label="policyLabel"
        @click="openAutograbSettings('movie')"
      />
      <UiButton
        icon="refresh"
        label="立即检查"
        :loading="data?.running"
        @click="runNow"
      />
    </header>

    <SettingsGroup v-if="notice || ov.error.value" class="gp-needs">
      <SettingsRow>
        <template #description>
          <span class="gp-need">
            <UiIcon class="gp-need-icon" name="warning" size="sm" />{{
              ov.error.value ?? notice
            }}
          </span>
        </template>
        <UiButton
          v-if="needsNetdisk"
          size="sm"
          label="去设置"
          @click="openNetdiskSettings()"
        />
      </SettingsRow>
    </SettingsGroup>

    <GrabSection
      v-if="pending.length"
      title="需要你处理"
      :count="`${pending.length} 部`"
    >
      <ul class="grab-tasks">
        <li v-for="movie in pending" :key="movie.tmdbId">
          <GrabTaskCard
            :title="titleOf(movie)"
            :subtitle="
              movie.releaseDate ? `${movie.releaseDate} 上线` : '已上线'
            "
            :poster="posterOf(movie.poster)"
            :state="movie.status === 'found' ? '待确认' : '没找到'"
            :tone="movie.status === 'found' ? 'pending' : 'problem'"
            :candidate="movie.candidates[0] ?? null"
            :reason="moviePendingReason(movie)"
          >
            <template #actions>
              <UiButton
                class="ag-quiet"
                size="sm"
                variant="plain"
                :label="
                  movie.candidates.length > 1
                    ? `另 ${movie.candidates.length - 1} 个`
                    : '详情'
                "
                @click="sheetId = movie.tmdbId"
              />
              <span class="ag-grow" />
              <UiButton
                v-if="movie.status === 'found'"
                size="sm"
                variant="primary"
                icon="download"
                label="转存"
                :loading="busy === movie.tmdbId"
                @click="grab(movie.tmdbId)"
              />
              <UiButton
                v-else
                size="sm"
                icon="refresh"
                label="现在重搜"
                @click="retry(movie.tmdbId)"
              />
            </template>
          </GrabTaskCard>
        </li>
      </ul>
    </GrabSection>

    <GrabSection
      title="追踪中的电影"
      :count="data ? `${data.movies.length} 部` : undefined"
    >
      <template #actions>
        <form class="gp-search" @submit.prevent="search(query)">
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
      </template>

      <div v-if="suggestions.length && !hits.length" class="gp-chips">
        <span class="gp-meta">想看里的：</span>
        <UiChip
          v-for="title in suggestions"
          :key="title"
          :label="title"
          @click="search(title)"
        />
      </div>

      <template v-if="hits.length">
        <p class="gp-meta">搜索结果：点「+」加入追踪</p>
        <div class="ui-poster-grid gp-posters">
          <UiPosterCard
            v-for="hit in hits"
            :key="hit.tmdbId"
            :title="hit.title"
            :cover="posterOf(hit.poster) ?? undefined"
            :subtitle="
              tracked.has(hit.tmdbId)
                ? '已在追踪'
                : hit.year
                  ? String(hit.year)
                  : ''
            "
            @open="
              tracked.has(hit.tmdbId)
                ? (sheetId = hit.tmdbId)
                : track(hit.tmdbId)
            "
          >
            <template v-if="!tracked.has(hit.tmdbId)" #actions>
              <UiIconButton
                icon="plus"
                variant="overlay"
                size="sm"
                :label="`追踪 ${hit.title}`"
                @click.stop="track(hit.tmdbId)"
              />
            </template>
          </UiPosterCard>
        </div>
      </template>

      <div v-if="data?.movies.length" class="ui-poster-grid gp-posters">
        <UiPosterCard
          v-for="movie in data.movies"
          :key="movie.tmdbId"
          :title="movie.title"
          :cover="posterOf(movie.poster) ?? undefined"
          :subtitle="movieNote(movie) || (movie.year ? String(movie.year) : '')"
          @open="sheetId = movie.tmdbId"
        >
          <template #badges>
            <span class="gp-chip" :data-tone="chipTone(movie.status)">{{
              MOVIE_STATUS_LABEL[movie.status]
            }}</span>
          </template>
        </UiPosterCard>
      </div>
      <p v-else-if="data" class="gp-empty">
        {{
          nas
            ? '还没有追踪的电影，在右上角搜一部加入追踪'
            : '还没有追踪的电影：在线详情页点「追踪上线」，或在右上角搜一部'
        }}
      </p>
    </GrabSection>

    <MovieGrabSheet
      :movie="sheetMovie"
      :overview="data"
      :report="ov.report"
      :refresh="ov.refresh"
      @close="sheetId = null"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 自动追更页「电影」栏，与剧集栏同一套版式：一条工具栏（状态句、转存位置、全局策略、立即检查），缺前置条件时一组玻璃分组；
 * 「需要你处理」是有资源待确认 / 没找到的电影卡片（GrabTaskCard，主按钮转存或重搜）；
 * 「追踪中的电影」是海报墙（左上角状态胶囊），标题行右侧搜 TMDB 加入追踪（想看清单里的片名可一键搜）；
 * 点海报打开这部电影的侧板（MovieGrabSheet：方式、资源偏好、候选、重搜、不再追踪）。
 */
import { computed, onDeactivated, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import { toast } from '@/components/ui/toast'
import {
  GrabSection,
  GrabTaskCard,
  MOVIE_MODE_OPTIONS,
  openAutograbSettings,
  optionLabel,
  prefsSummary,
} from '@/features/autograb'
import {
  type FolderPick,
  type FolderPreset,
  TargetFolderPill,
  openNetdiskSettings,
} from '@/features/netdisk'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import { watchlistEntries } from '@/features/watchlist'
import { thumbSrc } from '@/services/thumbnails'
import type {
  MovieSearchHit,
  MovieTrackStatus,
  TrackedMovie,
} from '../../../../../shared/contract/autograb-upgrade'
import {
  type TargetFolder,
  folderOf,
} from '../../../../../shared/netdisk/target-folder'

import { moviesApi } from '../api'
import {
  MOVIE_STATUS_LABEL,
  movieNote,
  moviePendingReason,
  moviesNotice,
  moviesStatusLine,
  pendingMovies,
  watchlistTitles,
} from '../upgrade-rules'
import { useOverview } from '../use-overview'
import MovieGrabSheet from './MovieGrabSheet.vue'

const nas = import.meta.env.MODE === 'nas'
const ov = useOverview(moviesApi())
const data = computed(() => ov.data.value)
const tracked = computed(() => new Set(data.value?.movies.map(m => m.tmdbId)))
const pending = computed(() => pendingMovies(data.value))
const suggestions = computed(() => watchlistTitles(watchlistEntries().value))
const notice = computed(() => (data.value ? moviesNotice(data.value) : null))
/** 缺的是网盘设置（115 登录、PanSou）：给「去设置」 */
const needsNetdisk = computed(
  () => !!data.value && (!data.value.ready.loggedIn || !data.value.ready.pansou)
)
const query = ref('')
const hits = ref<MovieSearchHit[]>([])
const busy = ref<number | null>(null)
/** 侧板里打开的电影 */
const sheetId = ref<number | null>(null)
const sheetMovie = computed(
  () => data.value?.movies.find(m => m.tmdbId === sheetId.value) ?? null
)
onDeactivated(() => (sheetId.value = null))

/** 全局策略按钮上的字：全局策略 · 待确认 · 均衡 */
const policyLabel = computed(() => {
  const policy = data.value?.policy
  if (!policy) return '全局策略'
  return `全局策略 · ${optionLabel(MOVIE_MODE_OPTIONS, policy.mode)} · ${prefsSummary(policy.prefs)}`
})

/** 转存位置胶囊：电影栏单独选了文件夹显示它，否则是「电影默认目录」 */
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

function titleOf(movie: TrackedMovie): string {
  return movie.year ? `${movie.title} (${movie.year})` : movie.title
}

/** 海报左上角状态胶囊的色调 */
function chipTone(status: MovieTrackStatus): string | undefined {
  if (status === 'found') return 'pending'
  if (status === 'saved' || status === 'done') return 'done'
  return status === 'notFound' ? 'problem' : undefined
}

/** TMDB 海报 → 缩略图地址（列表里只要小图） */
function posterOf(url: string | null): string | null {
  return url ? thumbSrc(url, 300) : null
}

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
  if (ov.report(await moviesApi().track(tmdbId), '已加入追踪')) {
    hits.value = []
    query.value = ''
  }
}

async function grab(tmdbId: number): Promise<void> {
  if (busy.value !== null) return
  busy.value = tmdbId
  try {
    ov.report(await moviesApi().grab(tmdbId, 0), '已转存，等待入库')
  } finally {
    busy.value = null
  }
}

async function retry(tmdbId: number): Promise<void> {
  await moviesApi().retry(tmdbId)
  ov.refresh()
}

/** 选「电影默认目录」清掉电影栏的单独文件夹；选了文件夹就存成电影追踪的位置 */
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
