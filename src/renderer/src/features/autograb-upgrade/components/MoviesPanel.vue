<template>
  <section class="grab-panel" aria-label="电影上线追踪">
    <header class="grab-head">
      <div class="grab-head-text">
        <h2 class="grab-title">电影上线</h2>
        <p class="grab-sub">
          数字发行后每天搜一次 WEB-DL / BluRay，30 天为止；存到
          {{
            data?.cidName ||
            (data?.cid ? `文件夹 ${data.cid}` : '设置里的转存目标')
          }}
        </p>
      </div>
      <UiButton
        size="sm"
        variant="plain"
        icon="folder"
        label="选文件夹"
        :disabled="!data?.ready.loggedIn"
        @click="picking = !picking"
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
    <div v-if="picking" class="grab-picker">
      <NetdiskFolderPicker :start-cid="data?.cid || '0'" @pick="pickFolder" />
    </div>

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
          <UiSegmented
            v-if="movie.status !== 'done'"
            :model-value="movie.mode"
            :options="MODE_OPTIONS"
            :label="`${movie.title} 的转存方式`"
            size="sm"
            @update:model-value="mode => setMode(movie.tmdbId, mode)"
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
 * 电影上线追踪面板：电影统一转存到的 115 文件夹、TMDB 搜片加入追踪（想看清单里的片名可一键搜）；
 * 追踪中的电影显示上线日期 / 搜索进度 / 候选，逐部选「待确认 / 全自动」，可重搜、移除。
 */
import { computed, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { toast } from '@/components/ui/toast'
import { NetdiskFolderPicker } from '@/features/netdisk'
import { watchlistEntries } from '@/features/watchlist'
import type {
  MovieMode,
  MovieSearchHit,
} from '../../../../../shared/contract/autograb-upgrade'
import type { Pan115Dir } from '../../../../../shared/contract/pan115'

import { moviesApi } from '../api'
import {
  MOVIE_STATUS_LABEL,
  candidateMeta,
  movieNote,
  moviesNotice,
  watchlistTitles,
} from '../upgrade-rules'
import { useOverview } from '../use-overview'

const MODE_OPTIONS: { value: MovieMode; label: string }[] = [
  { value: 'confirm', label: '待确认' },
  { value: 'auto', label: '全自动' },
]

const ov = useOverview(moviesApi())
const data = computed(() => ov.data.value)
const tracked = computed(() => new Set(data.value?.movies.map(m => m.tmdbId)))
const suggestions = computed(() => watchlistTitles(watchlistEntries().value))
const query = ref('')
const hits = ref<MovieSearchHit[]>([])
const busy = ref<string | null>(null)
const picking = ref(false)

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

async function setMode(tmdbId: number, mode: MovieMode): Promise<void> {
  ov.report(await moviesApi().setMode(tmdbId, mode))
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

async function pickFolder(dir: Pan115Dir): Promise<void> {
  picking.value = false
  await moviesApi().setFolder(dir.cid, dir.name || '根目录')
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
