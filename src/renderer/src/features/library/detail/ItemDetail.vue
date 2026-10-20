<template>
  <div ref="root" class="lib-detail custom-scrollbar" tabindex="-1">
    <div v-if="!node && loading" class="lib-detail-status">正在载入…</div>
    <div v-else-if="!node" class="lib-detail-status">
      {{ error || '条目不存在或已被移除' }}
      <UiButton label="返回" variant="secondary" @click="emit('close')" />
    </div>

    <template v-else>
      <!-- 头图：背景图渐隐到页面底色，标志 / 片名、信息行、操作、简介叠在上面 -->
      <header class="lib-hero">
        <img
          v-if="backdrop"
          class="lib-hero-image"
          :src="backdrop"
          alt=""
          decoding="async"
          @load="onFadeIn"
        />
        <div class="lib-hero-fade" />
        <UiIconButton
          class="lib-hero-back"
          icon="back"
          variant="overlay"
          label="返回"
          @click="emit('close')"
        />
        <div class="lib-hero-content">
          <img
            v-if="logo && !logoBroken"
            class="lib-hero-logo"
            :src="logo"
            :alt="node.title"
            decoding="async"
            referrerpolicy="no-referrer"
            @error="logoBroken = true"
          />
          <h1 v-else class="lib-hero-title">{{ node.title }}</h1>
          <p v-if="metaLine.length" class="lib-hero-meta">
            <span
              v-for="part in metaLine"
              :key="part"
              class="lib-hero-meta-part"
            >
              {{ part }}
            </span>
            <span
              v-if="
                node.matchState === 'review' || node.matchState === 'unmatched'
              "
              class="lib-hero-state"
              >{{ MATCH_STATE_LABEL[node.matchState] }}</span
            >
          </p>
          <div class="lib-hero-actions">
            <UiButton
              variant="primary"
              size="lg"
              icon="play"
              :label="playLabel"
              :disabled="!primaryPlay"
              @click="playPrimary"
            />
            <UiIconButton
              icon="wand"
              variant="secondary"
              size="lg"
              label="修正匹配"
              @click="emit('fix-match', node.id)"
            />
            <UiIconButton
              :icon="node.matchState === 'locked' ? 'lock' : 'pin'"
              variant="secondary"
              size="lg"
              :active="node.matchState === 'locked'"
              :label="node.matchState === 'locked' ? '解除锁定' : '锁定匹配'"
              :disabled="!node.providerIds.tmdb"
              :loading="busy === 'lock'"
              @click="toggleLock"
            />
            <UiIconButton
              icon="refresh"
              variant="secondary"
              size="lg"
              label="重新获取元数据"
              :disabled="!node.providerIds.tmdb"
              :loading="busy === 'refresh'"
              @click="refreshMetadata"
            />
            <span v-tooltip="writerAvailable ? '' : WRITER_UNAVAILABLE">
              <UiIconButton
                icon="save"
                variant="secondary"
                size="lg"
                label="写出 NFO 与图片"
                :disabled="!writerAvailable || !node.providerIds.tmdb"
                :loading="busy === 'write'"
                @click="writeOut"
              />
            </span>
            <span v-tooltip="writerAvailable ? '' : WRITER_UNAVAILABLE">
              <UiIconButton
                icon="folder"
                variant="secondary"
                size="lg"
                label="整理…"
                :disabled="!writerAvailable"
                @click="emit('organize', [node.id])"
              />
            </span>
          </div>
          <p v-if="tagline" class="lib-hero-tagline">{{ tagline }}</p>
          <p
            v-if="node.overview"
            class="lib-hero-overview"
            :class="{ 'is-expanded': overviewOpen }"
            @click="overviewOpen = !overviewOpen"
          >
            {{ node.overview }}
          </p>
        </div>
      </header>

      <!-- 剧集：按季分段 + 集列表 -->
      <section v-if="seasons.length" class="lib-section">
        <div class="lib-section-head">
          <h2 class="lib-section-title">剧集</h2>
          <UiSegmented
            v-if="seasons.length <= 8"
            v-model="seasonKey"
            size="sm"
            label="选择季"
            :options="seasonOptions"
          />
          <UiSelect
            v-else
            v-model="seasonKey"
            size="sm"
            aria-label="选择季"
            :options="
              seasonOptions.map(o => ({ value: o.value, label: o.label! }))
            "
          />
        </div>
        <p v-if="seasonOverview" class="lib-season-overview">
          {{ seasonOverview }}
        </p>
        <ol class="lib-episodes">
          <li
            v-for="ep in episodes"
            :key="ep.id"
            class="lib-episode"
            :class="{ 'is-missing': !hasFile(ep) }"
          >
            <UiPressable
              class="lib-episode-still"
              :label="`播放 ${ep.title}`"
              :disabled="!hasFile(ep)"
              @click="playEpisode(ep)"
            >
              <img
                v-if="ep.poster"
                :src="ep.poster"
                alt=""
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
              />
              <span class="lib-episode-play" aria-hidden="true">
                <UiIcon name="play" filled />
              </span>
            </UiPressable>
            <div class="lib-episode-text">
              <div class="lib-episode-head">
                <span class="lib-episode-number">{{ ep.episodeNumber }}</span>
                <span class="lib-episode-title">{{ ep.title }}</span>
              </div>
              <div class="lib-episode-meta">
                <span v-if="ep.airDate">{{ ep.airDate }}</span>
                <span v-if="ep.runtime">{{ formatRuntime(ep.runtime) }}</span>
                <span v-if="!hasFile(ep)">本地缺失</span>
              </div>
              <p v-if="ep.overview" class="lib-episode-overview">
                {{ ep.overview }}
              </p>
            </div>
          </li>
        </ol>
      </section>

      <!-- 演职员：横向滑动 -->
      <section v-if="people.length" class="lib-section">
        <h2 class="lib-section-title">演职员</h2>
        <ul class="lib-cast custom-scrollbar">
          <li v-for="person in people" :key="person.key" class="lib-person">
            <div class="lib-person-photo">
              <img
                v-if="person.photo"
                :src="person.photo"
                alt=""
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
              />
              <span v-else>{{ person.name.slice(0, 1) }}</span>
            </div>
            <div class="lib-person-name">{{ person.name }}</div>
            <div class="lib-person-role">{{ person.role }}</div>
          </li>
        </ul>
      </section>

      <!-- 信息与文件 -->
      <section class="lib-section lib-info">
        <div v-if="infoRows.length" class="lib-info-block">
          <h2 class="lib-section-title">信息</h2>
          <dl class="lib-info-list">
            <template v-for="row in infoRows" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </template>
          </dl>
        </div>
        <div class="lib-info-block">
          <h2 class="lib-section-title">文件</h2>
          <ul class="lib-files">
            <li v-for="file in files" :key="file.id" class="lib-file">
              <div class="lib-file-text">
                <div class="lib-file-name" :title="file.path">
                  {{ baseName(file.path) }}
                </div>
                <div class="lib-file-meta">
                  {{ formatBytes(file.size) }} · {{ dirName(file.path) }}
                </div>
              </div>
              <UiIconButton
                icon="externalLink"
                size="sm"
                label="在文件夹中显示"
                @click="reveal(file.path)"
              />
            </li>
            <li v-if="!files.length" class="lib-file-empty">没有视频文件</li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 条目详情（Apple TV 风格）：780w 背景图渐隐、标志或片名、年份 · 时长 · 分级 · 评分、简介，
 * 剧集按季分段与集列表，演职员横滑，信息与文件。播放接现有 openMediaPlayer（内置 / mpv）。
 */
import { message } from 'ant-design-vue'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'

import type {
  LibraryItemFile,
  LibraryItemNode,
} from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { vTooltip } from '@/components/ui/tooltip'

import { errorText, libraryBridge } from '../api/bridge'
import { itemImage, tmdbImage } from '../api/images'
import { onLibraryEvent } from '../state/library-events'
import {
  MATCH_STATE_LABEL,
  baseName,
  dirName,
  formatBytes,
  formatRating,
  formatRuntime,
} from '../shared/format'
import { WRITER_UNAVAILABLE, useWriter } from '../writer/use-writer'
import {
  type PlayRequest,
  episodePlayRequest,
  moviePlayRequest,
  play,
  playableEpisodes,
  videoFiles,
} from './playback'

const props = defineProps<{ itemId: number }>()
const emit = defineEmits<{
  close: []
  'fix-match': [itemId: number]
  organize: [itemIds: number[]]
}>()

const bridge = libraryBridge()
const { available: writerAvailable, write } = useWriter()
const root = ref<HTMLElement | null>(null)
const node = shallowRef<LibraryItemNode | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)
const logoBroken = ref(false)
const overviewOpen = ref(false)
const seasonKey = ref('')

async function load(resetView: boolean): Promise<void> {
  if (!bridge) return
  const id = props.itemId
  loading.value = true
  try {
    const item = await bridge.getItem(id)
    if (id !== props.itemId) return
    node.value = item
    error.value = null
    if (resetView) {
      logoBroken.value = false
      overviewOpen.value = false
      seasonKey.value = defaultSeasonKey(item)
      await nextTick()
      root.value?.scrollTo({ top: 0 })
      root.value?.focus({ preventScroll: true })
    }
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.itemId,
  () => void load(true),
  { immediate: true }
)

// 识别 / 刷新元数据完成后，引擎推送 items-changed，详情跟着更新
onLibraryEvent(event => {
  if (
    event.type === 'items-changed' &&
    (event.reset || event.updated.includes(props.itemId))
  ) {
    void load(false)
  }
})

const titleMeta = computed(() =>
  node.value?.metadata?.level === 'title' ? node.value.metadata : null
)

const backdrop = computed(() => itemImage(node.value?.backdrop ?? null, 780))
const logo = computed(() => node.value?.logo ?? null)
const tagline = computed(() => titleMeta.value?.tagline ?? '')

const metaLine = computed(() => {
  const n = node.value
  if (!n) return []
  const parts: string[] = []
  if (n.year) parts.push(String(n.year))
  if (n.type === 'movie' && n.runtime) parts.push(formatRuntime(n.runtime))
  if (n.type === 'series' && seasons.value.length) {
    parts.push(`${seasons.value.filter(s => s.seasonNumber !== 0).length} 季`)
  }
  if (titleMeta.value?.certification) parts.push(titleMeta.value.certification)
  if (n.rating) parts.push(`★ ${formatRating(n.rating)}`)
  if (n.genres.length) parts.push(n.genres.slice(0, 3).join(' / '))
  return parts
})

// —— 剧集 ——
const seasons = computed(() =>
  (node.value?.children ?? [])
    .filter(child => child.type === 'season')
    .sort((a, b) => seasonOrder(a) - seasonOrder(b))
)

/** 特别篇（第 0 季）排在最后。 */
function seasonOrder(season: LibraryItemNode): number {
  return season.seasonNumber === 0 ? 1e6 : (season.seasonNumber ?? 1e5)
}

function seasonName(season: LibraryItemNode): string {
  if (season.seasonNumber === 0) return '特别篇'
  return season.seasonNumber === null
    ? season.title
    : `第 ${season.seasonNumber} 季`
}

function defaultSeasonKey(item: LibraryItemNode | null): string {
  const first = (item?.children ?? [])
    .filter(child => child.type === 'season')
    .sort((a, b) => seasonOrder(a) - seasonOrder(b))[0]
  return first ? String(first.id) : ''
}

const seasonOptions = computed(() =>
  seasons.value.map(s => ({ value: String(s.id), label: seasonName(s) }))
)
const currentSeason = computed(
  () => seasons.value.find(s => String(s.id) === seasonKey.value) ?? null
)
const seasonOverview = computed(() => currentSeason.value?.overview ?? '')
const episodes = computed(() =>
  (currentSeason.value?.children ?? [])
    .filter(child => child.type === 'episode')
    .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))
)

const hasFile = (ep: LibraryItemNode): boolean => videoFiles(ep).length > 0

// —— 播放 ——
const primaryPlay = computed<PlayRequest | null>(() => {
  const n = node.value
  if (!n) return null
  if (n.type === 'movie') return moviePlayRequest(n)
  for (const season of seasons.value) {
    const first = playableEpisodes(season)[0]
    if (first) return episodePlayRequest(n, season, first)
  }
  return null
})

const playLabel = computed(() => {
  const n = node.value
  if (n?.type !== 'series' || !primaryPlay.value) return '播放'
  return `播放 ${primaryPlay.value.playlist[primaryPlay.value.index].name ?? ''}`
})

async function startPlayback(request: PlayRequest): Promise<void> {
  const ok = await play(
    request,
    itemImage(node.value?.poster ?? null, 780) ?? undefined
  )
  if (!ok) message.warning('当前环境无法播放本地文件')
}

function playPrimary(): void {
  if (primaryPlay.value) void startPlayback(primaryPlay.value)
}

function playEpisode(ep: LibraryItemNode): void {
  const n = node.value
  const season = currentSeason.value
  if (!n || !season) return
  const request = episodePlayRequest(n, season, ep)
  if (request) void startPlayback(request)
}

// —— 演职员 ——
const people = computed(() => {
  const meta = titleMeta.value
  if (!meta) return []
  const crew = meta.crew
    .filter(p => p.job === 'Director' || p.job === 'Creator')
    .map(p => ({
      key: `crew-${p.id}-${p.job}`,
      name: p.name,
      role: p.job === 'Director' ? '导演' : '主创',
      photo: tmdbImage(p.profilePath),
    }))
  const cast = meta.cast.map(p => ({
    key: `cast-${p.id}`,
    name: p.name,
    role: p.character ?? '',
    photo: tmdbImage(p.profilePath),
  }))
  return [...crew, ...cast]
})

// —— 信息与文件 ——
const infoRows = computed(() => {
  const n = node.value
  const meta = titleMeta.value
  if (!n) return []
  const rows: Array<{ label: string; value: string }> = []
  if (n.originalTitle && n.originalTitle !== n.title) {
    rows.push({ label: '原名', value: n.originalTitle })
  }
  if (meta?.releaseDate) rows.push({ label: '上映', value: meta.releaseDate })
  const writers = meta?.crew
    .filter(p => p.job === 'Screenplay' || p.job === 'Writer')
    .map(p => p.name)
  if (writers?.length) rows.push({ label: '编剧', value: writers.join('、') })
  if (meta?.countries.length) {
    rows.push({ label: '国家 / 地区', value: meta.countries.join('、') })
  }
  if (meta?.companies.length) {
    rows.push({ label: '出品', value: meta.companies.slice(0, 3).join('、') })
  }
  if (meta?.status) rows.push({ label: '状态', value: meta.status })
  rows.push({ label: '匹配', value: MATCH_STATE_LABEL[n.matchState] })
  if (n.providerIds.tmdb)
    rows.push({ label: 'TMDB', value: n.providerIds.tmdb })
  if (n.providerIds.imdb)
    rows.push({ label: 'IMDb', value: n.providerIds.imdb })
  return rows
})

const files = computed<LibraryItemFile[]>(() => {
  const out: LibraryItemFile[] = []
  const visit = (n: LibraryItemNode): void => {
    for (const file of n.files) if (file.kind === 'video') out.push(file)
    n.children.forEach(visit)
  }
  if (node.value) visit(node.value)
  return out.sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true })
  )
})

function reveal(path: string): void {
  void window.api?.shell?.openPath(dirName(path))
}

// —— 操作 ——
async function run(name: string, task: () => Promise<unknown>): Promise<void> {
  busy.value = name
  try {
    await task()
  } catch (e) {
    message.error(errorText(e))
  } finally {
    busy.value = null
  }
}

function toggleLock(): void {
  const n = node.value
  if (!n || !bridge) return
  void run('lock', async () => {
    await (n.matchState === 'locked'
      ? bridge.unlockMatch(n.id)
      : bridge.lockMatch(n.id))
    await load(false)
  })
}

function refreshMetadata(): void {
  const n = node.value
  if (!n || !bridge) return
  void run('refresh', async () => {
    await bridge.refreshMetadata({ itemIds: [n.id] })
    message.info('已开始重新获取元数据')
  })
}

function writeOut(): void {
  const n = node.value
  if (!n) return
  void run('write', async () => {
    const failure = await write([n.id])
    if (failure) throw new Error(failure)
    message.info('已开始写出 NFO 与图片')
  })
}

function onFadeIn(event: Event): void {
  ;(event.target as HTMLElement).dataset.loaded = ''
}
</script>

<style scoped>
.lib-detail {
  position: absolute;
  inset: 0;
  z-index: var(--z-float);
  overflow-y: auto;
  background: var(--bg-content);
  outline: none;
}
.lib-detail-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  height: 100%;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

/* —— 头图 —— */
.lib-hero {
  position: relative;
  display: flex;
  align-items: flex-end;
  min-height: max(440px, 62vh);
  padding: var(--space-10) var(--content-padding-x) var(--space-8);
  overflow: hidden;
}
.lib-hero-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 20%;
  opacity: 0;
  transition: opacity var(--duration-slow) var(--ease-out);
}
.lib-hero-image[data-loaded] {
  opacity: 1;
}
/* 底部与左侧渐隐到页面底色，文字落在实色上，亮暗主题都清楚 */
.lib-hero-fade {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      to top,
      var(--bg-content) 0%,
      color-mix(in srgb, var(--bg-content) 70%, transparent) 30%,
      transparent 65%
    ),
    linear-gradient(
      to right,
      color-mix(in srgb, var(--bg-content) 85%, transparent) 0%,
      transparent 60%
    );
}
.lib-hero-back {
  position: absolute;
  top: var(--space-6);
  left: var(--content-padding-x);
  z-index: var(--z-raised);
}
.lib-hero-content {
  position: relative;
  z-index: var(--z-raised);
  max-width: 640px;
}
.lib-hero-logo {
  display: block;
  max-width: min(420px, 70%);
  max-height: 140px;
  margin-bottom: var(--space-5);
  object-fit: contain;
  object-position: left bottom;
}
.lib-hero-title {
  margin: 0 0 var(--space-4);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}
.lib-hero-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) 0;
  margin: 0 0 var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.lib-hero-meta-part + .lib-hero-meta-part::before {
  margin: 0 var(--space-2);
  content: '·';
}
.lib-hero-state {
  margin-left: var(--space-3);
  padding: var(--space-0_5) var(--space-2);
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--warning) 18%, transparent);
  color: var(--warning);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
}
.lib-hero-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}
.lib-hero-actions > span {
  display: inline-flex;
}
.lib-hero-tagline {
  margin: 0 0 var(--space-2);
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
}
.lib-hero-overview {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  cursor: pointer;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}
.lib-hero-overview.is-expanded {
  display: block;
}

/* —— 区块 —— */
.lib-section {
  padding: var(--space-7) var(--content-padding-x) 0;
}
.lib-section:last-child {
  padding-bottom: var(--space-10);
}
.lib-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.lib-section-title {
  margin: 0 0 var(--space-4);
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}
.lib-section-head .lib-section-title {
  margin: 0;
}
.lib-season-overview {
  max-width: 720px;
  margin: 0 0 var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

/* —— 集列表 —— */
.lib-episodes {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  margin: 0;
  padding: 0;
  list-style: none;
}
.lib-episode {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}
.lib-episode.is-missing {
  opacity: 0.55;
}
.lib-episode-still {
  position: relative;
  display: block;
  width: 240px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
}
.lib-episode-still img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lib-episode-play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--overlay-scrim-soft);
  color: var(--media-text);
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}
.lib-episode-still:hover .lib-episode-play,
.lib-episode-still:focus-visible .lib-episode-play {
  opacity: 1;
}
.lib-episode-head {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
}
.lib-episode-number {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.lib-episode-meta {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.lib-episode-overview {
  display: -webkit-box;
  margin: var(--space-2) 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* —— 演职员 —— */
.lib-cast {
  display: flex;
  gap: var(--space-5);
  margin: 0 calc(var(--content-padding-x) * -1);
  padding: 0 var(--content-padding-x) var(--space-3);
  overflow-x: auto;
  list-style: none;
  scroll-padding-inline: var(--content-padding-x);
  scroll-snap-type: x proximity;
}
.lib-person {
  flex: 0 0 104px;
  text-align: center;
  scroll-snap-align: start;
}
.lib-person-photo {
  display: grid;
  width: 104px;
  height: 104px;
  margin-bottom: var(--space-3);
  overflow: hidden;
  place-items: center;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
  color: var(--text-tertiary);
  font-size: var(--text-xl);
}
.lib-person-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lib-person-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-person-role {
  margin-top: var(--space-0_5);
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* —— 信息与文件 —— */
.lib-info {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-8);
}
.lib-info-list {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-2) var(--space-5);
  margin: 0;
  font-size: var(--text-sm);
}
.lib-info-list dt {
  color: var(--text-tertiary);
}
.lib-info-list dd {
  margin: 0;
  color: var(--text-primary);
  word-break: break-word;
}
.lib-files {
  margin: 0;
  padding: 0;
  list-style: none;
}
.lib-file {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
}
.lib-file + .lib-file {
  border-top: 1px solid var(--separator);
}
.lib-file-text {
  flex: 1 1 auto;
  min-width: 0;
}
.lib-file-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-file-meta {
  margin-top: var(--space-0_5);
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-file-empty {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

@media (max-width: 720px) {
  .lib-episode {
    grid-template-columns: 1fr;
  }
  .lib-episode-still {
    width: 100%;
  }
}
</style>
