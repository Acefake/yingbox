<template>
  <div class="detail-win">
    <!-- 加载中 -->
    <div v-if="tmdb.loading.value" class="dw-loading">
      <div class="dw-spinner" />
      <span>正在加载详情...</span>
    </div>

    <div v-else class="dw-body">
      <!-- 背景大图 -->
      <div class="dw-backdrop">
        <img
          v-if="tmdbDetail?.backdrop_path"
          :src="tmdbImage('original', tmdbDetail.backdrop_path)"
          class="dw-backdrop-img"
        />
        <div class="dw-backdrop-overlay" />
      </div>

      <!-- 内容 -->
      <div class="dw-content min-w-0">
        <DetailHero
          :tmdb-detail="tmdbDetail"
          :item-data="itemData"
          :item-name="itemName"
          :item-pic="itemPic"
          :item-overview="itemOverview"
          :directors="tmdb.directors.value"
          :current-episodes="sources.currentEpisodes.value"
          @play="playEp"
        >
          <template #actions>
            <WatchlistButton :meta="watchlistMeta" />
            <MovieTrackButton
              :tmdb-id="tmdbDetail?.title ? tmdbDetail.id : null"
            />
          </template>
          <DetailSourcePicker
            :searching="sources.searching.value"
            :has-groups="sources.episodeGroups.value.length > 0"
            :source-type-options="sources.typeOptions.value"
            :current-source-type="sources.currentSourceType.value"
            :site-groups="sources.siteGroups.value"
            :active-site="sources.activeSite.value"
            :active-line="sources.activeLine.value"
            :current-episodes="sources.currentEpisodes.value"
            :current-url="currentUrl"
            :probes="sources.probes.value"
            :probing="sources.probing.value"
            @switch-type="sources.switchSourceType"
            @switch-site="sources.switchSite"
            @switch-line="sources.switchLine"
            @reprobe="sources.reprobe"
            @play="playEp"
          />
        </DetailHero>
        <DetailCastGallery
          :cast="tmdb.cast.value"
          :images="tmdb.images.value"
          @open="lightboxIdx = $event"
        />
      </div>
    </div>

    <DetailLightbox v-model:index="lightboxIdx" :images="tmdb.images.value" />
  </div>
</template>

<script setup lang="ts">
/**
 * 在线详情页：TMDB 元信息 + 跨源播放源选择 + 播放。
 * 主信息、播放源选择、演员剧照、灯箱分别是 ./Detail* 子组件；
 * TMDB 与播放源加载在 useTmdbDetail / useDetailSources，规则在 ../utils/detail-sources。
 */
import { toast } from '@/components/ui'
import { asText } from '@/utils/json'
import { readStoredArray, saveStoredArray } from '@/utils/storage'
import { asRawVod } from '@/utils/vod-data'
import { htmlToText } from '@/utils/html-text'
import { computed, onMounted, ref, watch } from 'vue'
import { isIncognito } from '@/features/incognito'
import { getMediaProgress, openMediaPlayer } from '@/features/player'
import { WatchlistButton, type WatchlistMeta } from '@/features/watchlist'
import { MovieTrackButton } from '@/features/autograb-upgrade'
import { resolvePageToMedia } from '../utils/play-source'
import {
  buildFallbacks,
  buildPlaylist,
  guessMediaType,
  mergeOnlineHistory,
  tmdbImage,
} from '../utils/detail-sources'
import { useOnlineSearch } from '../composables/use-online-search'
import { useDetailSources } from '../composables/use-detail-sources'
import { useTmdbDetail } from '../composables/use-tmdb-detail'
import { doubanSubjectId } from '../utils/douban-preview'
import DetailCastGallery from './DetailCastGallery.vue'
import DetailHero from './DetailHero.vue'
import DetailLightbox from './DetailLightbox.vue'
import DetailSourcePicker from './DetailSourcePicker.vue'
import type {
  CmsItem,
  OnlineDetailItem,
  OnlinePlayRecord,
  PluginExt,
} from '../types'

const HISTORY_KEY = 'online_play_history'
const props = defineProps<{ item?: unknown }>()
const { resolvePlayUrl } = useOnlineSearch()
const tmdb = useTmdbDetail()
const sources = useDetailSources()
const tmdbDetail = computed(() => tmdb.detail.value)

const itemData = ref<OnlineDetailItem | null>(null)
const itemName = ref('')
const itemPic = ref('')
const itemOverview = ref('')
const searchTitle = ref('')
const lightboxIdx = ref<number | null>(null)
const currentUrl = ref('')
/** 播放世代：换条目或再点一集时丢弃上一次还没解析完的播放 */
let playGeneration = 0
/** 载入世代：换条目时丢弃上一部还没走完的载入 */
let loadGeneration = 0

const loadData = async (raw: unknown): Promise<void> => {
  if (!raw) return
  // 条目可能来自别的窗口，字段都按可能缺失读
  const data = asRawVod(raw) as OnlineDetailItem
  itemData.value = data
  itemName.value = data.vod_name || ''
  itemPic.value = data.vod_pic || ''
  // CMS 简介常带 <p> / &nbsp; 等 HTML，只显示纯文本
  itemOverview.value = htmlToText(
    data.overview || data.vod_content || data.vod_desc || ''
  )
  searchTitle.value = data.searchTitle || data.vod_name || ''
  tmdb.reset()
  playGeneration++
  sources.episodeGroups.value = []
  currentUrl.value = ''
  const type = guessMediaType(data.type_name || '')
  const doubanId = doubanSubjectId(data.doubanUrl || '')
  const generation = ++loadGeneration
  await tmdb.fetchTmdb(
    searchTitle.value || itemName.value,
    type,
    doubanId ? { id: doubanId, kind: data.doubanKind ?? type } : null
  )
  // 等 TMDB 期间换了条目：新条目自己的 loadData 会加载播放源
  if (generation !== loadGeneration) return
  // 自动加载播放源：先保留打开详情时命中的条目，再按片名检索全部已启用源
  const direct = data._source === 'cms' || data._source === 'catspider'
  // _source 是 cms / catspider 的就是搜索 / 浏览结果里的 CmsItem
  await sources.load(direct ? (data as CmsItem) : null, searchTitle.value)
}

onMounted(() => loadData(props.item))
watch(
  () => props.item,
  data => {
    if (data) loadData(data)
  }
)

/** 「想看」登记：键与继续播放相同（片名），整部看完时据此移出清单；海报优先 TMDB 竖版。 */
const watchlistMeta = computed<WatchlistMeta | null>(() => {
  if (!itemData.value || !itemName.value) return null
  return {
    section: 'online',
    key: itemName.value,
    title: itemName.value,
    poster:
      tmdbImage('w342', tmdbDetail.value?.poster_path) ||
      itemPic.value ||
      undefined,
    cover: tmdbImage('w780', tmdbDetail.value?.backdrop_path) || undefined,
    detail: itemData.value,
  }
})

/** 记一条播放历史：同一部片只保留最近一条（记住上次资源 / 集数）；无痕模式不记。 */
const recordHistory = (playUrl: string, ext?: PluginExt): void => {
  if (isIncognito()) return
  const item = itemData.value
  const mediaKey = String(
    item?.vod_id || item?.vod_name || itemName.value || playUrl
  )
  const record: OnlinePlayRecord = {
    ...(item || {}),
    item: item ?? undefined,
    epName: asText(ext?.name) || '正在播放',
    url: playUrl,
    progress: getMediaProgress(playUrl),
    groupLabel:
      sources.currentSourceType.value === 'catspider' ? '插件源' : 'CMS',
    timestamp: Date.now(),
  }
  const history = readStoredArray<OnlinePlayRecord>(HISTORY_KEY)
  saveStoredArray(HISTORY_KEY, mergeOnlineHistory(history, record, mediaKey))
}

/** 播放一集：插件线路先解析地址，再预解析跳转 / 页面内 m3u8，然后交给播放器（桌面端独立窗口）。 */
const playEp = async (url: string, ext?: PluginExt): Promise<void> => {
  const generation = ++playGeneration
  currentUrl.value = ''
  let playUrl = url
  const siteName = sources.currentSiteName.value
  // 测速中源列表会重排：线路与备用源按点击时的状态取
  const line = sources.currentLine.value
  const siteGroups = sources.siteGroups.value
  if (sources.currentSourceType.value === 'catspider' && siteName && ext) {
    const resolved = await resolvePlayUrl(siteName, ext)
    if (generation !== playGeneration) return
    if (resolved) playUrl = resolved
  }
  // 预解析跳转/页面内 m3u8，便于内置播放器直接播放
  playUrl = await resolvePageToMedia(playUrl)
  if (generation !== playGeneration) return

  currentUrl.value = playUrl
  recordHistory(playUrl, ext)
  const title =
    [itemName.value, asText(ext?.name)].filter(Boolean).join(' · ') ||
    itemName.value ||
    '正在播放'
  // 带上当前线路的剧集队列与同集备用源（已按测速排序）：播放器据此自动连播、卡顿 / 失败换源
  const playlist = buildPlaylist(line)
  const epIndex = playlist.findIndex(item => item.url === url)
  const fallbacks = buildFallbacks(siteGroups, line, asText(ext?.name), epIndex)
  const ok = await openMediaPlayer({
    url: playUrl,
    title,
    poster: itemPic.value || undefined,
    startAt: getMediaProgress(playUrl),
    ...(playlist.length ? { playlist, index: epIndex >= 0 ? epIndex : 0 } : {}),
    ...(fallbacks.length ? { fallbacks } : {}),
    // 继续播放：按片名合并（换源后仍是同一张卡），封面优先 TMDB 横版背景图
    continueAs: {
      section: 'online',
      key: itemName.value || playUrl,
      title: itemName.value || title,
      cover:
        tmdbImage('w780', tmdbDetail.value?.backdrop_path) ||
        itemPic.value ||
        undefined,
      detail: itemData.value ?? undefined,
    },
  })
  if (!ok) toast.error('无法打开播放器，请完全重启应用后再试')
}
</script>

<style scoped>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.detail-win {
  width: 100vw;
  height: 100vh;
  background: var(--bg-content);
  color: var(--text-primary);
  font-family: var(--font-sans);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dw-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.dw-spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid var(--border-subtle);
  border-top-color: var(--accent);
  animation: spin var(--duration-spin) linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.dw-body {
  flex: 1;
  overflow-y: auto;
  position: relative;
}

.dw-body::-webkit-scrollbar {
  width: 4px;
}

.dw-body::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: var(--radius-xs);
}

.dw-backdrop {
  position: absolute;
  inset: 0 0 auto;
  width: 100%;
  height: 360px;
  overflow: hidden;
}

.dw-backdrop-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
  filter: brightness(0.5);
}

.dw-backdrop-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 20%, var(--bg-content) 100%);
}

.dw-content {
  position: relative;
  width: 100%;
  min-width: 0;
  padding: calc(var(--shell-top) + var(--space-8)) var(--detail-gutter)
    var(--space-9) var(--detail-x);
}
</style>
