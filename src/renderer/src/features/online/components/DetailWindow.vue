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
          :src="tmdbImage('w1280', tmdbDetail.backdrop_path)"
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
          <DetailSourcePicker
            :searching="sources.searching.value"
            :has-groups="sources.episodeGroups.value.length > 0"
            :show-empty="showPlaySheet"
            :source-type-options="sources.typeOptions.value"
            :current-source-type="sources.currentSourceType.value"
            :site-groups="sources.siteGroups.value"
            :active-site="sources.activeSite.value"
            :active-line="sources.activeLine.value"
            :current-episodes="sources.currentEpisodes.value"
            :current-url="currentUrl"
            @switch-type="sources.switchSourceType"
            @switch-site="sources.switchSite"
            @switch-line="sources.switchLine"
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

    <!-- 播放弹窗（非 Electron 兜底） -->
    <Transition name="sheet-fade">
      <div
        v-if="showPlaySheet"
        class="sheet-mask"
        @click.self="showPlaySheet = false"
      >
        <div class="play-sheet">
          <div class="player-wrap">
            <UnifiedVideoPlayer
              :src="currentUrl"
              :resolve-url="resolvePageToMedia"
              :poster="tmdbImage('w1280', tmdbDetail?.backdrop_path)"
              :title="itemName"
              :subtitle-search-title="searchTitle || itemName"
              :subtitle-imdb-id="
                tmdbDetail?.imdb_id ? String(tmdbDetail.imdb_id) : ''
              "
              closable
              @close="showPlaySheet = false"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
/**
 * 在线详情页：TMDB 元信息 + 跨源播放源选择 + 播放。
 * 主信息、播放源选择、演员剧照、灯箱分别是 ./Detail* 子组件；
 * TMDB 与播放源加载在 useTmdbDetail / useDetailSources，规则在 ../utils/detail-sources。
 */
import { toast } from '@/components/ui'
import { readStoredArray, saveStoredArray } from '@/utils/storage'
import { computed, onMounted, ref, watch } from 'vue'
import {
  UnifiedVideoPlayer,
  canOpenElectronPlayer,
  getMediaProgress,
  openMediaPlayer,
} from '@/features/player'
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
import DetailCastGallery from './DetailCastGallery.vue'
import DetailHero from './DetailHero.vue'
import DetailLightbox from './DetailLightbox.vue'
import DetailSourcePicker from './DetailSourcePicker.vue'

const HISTORY_KEY = 'online_play_history'
const props = defineProps<{ item?: unknown }>()
const { resolvePlayUrl } = useOnlineSearch()
const tmdb = useTmdbDetail()
const sources = useDetailSources()
const tmdbDetail = computed(() => tmdb.detail.value)

const itemData = ref<any>(null)
const itemName = ref('')
const itemPic = ref('')
const itemOverview = ref('')
const searchTitle = ref('')
const lightboxIdx = ref<number | null>(null)
const showPlaySheet = ref(false)
const currentUrl = ref('')

const loadData = async (data: any) => {
  if (!data) return
  itemData.value = data
  itemName.value = data.vod_name || ''
  itemPic.value = data.vod_pic || ''
  itemOverview.value = data.overview || data.vod_content || data.vod_desc || ''
  searchTitle.value = data.searchTitle || data.vod_name || ''
  tmdb.reset()
  showPlaySheet.value = false
  sources.episodeGroups.value = []
  currentUrl.value = ''
  const type = guessMediaType(data.type_name || '')
  await tmdb.fetchTmdb(searchTitle.value || itemName.value, type)
  // 自动加载播放源：先保留打开详情时命中的条目，再按片名检索全部已启用源
  currentUrl.value = ''
  const direct = data._source === 'cms' || data._source === 'catspider'
  await sources.load(direct ? data : null, searchTitle.value)
}

onMounted(() => loadData(props.item))
watch(
  () => props.item,
  data => {
    if (data) loadData(data)
  }
)

let playGeneration = 0
watch(showPlaySheet, visible => {
  if (!visible) playGeneration++
})

/** 记一条播放历史：同一部片只保留最近一条（记住上次资源 / 集数）。 */
const recordHistory = (playUrl: string, ext?: Record<string, any>) => {
  const item = itemData.value
  const mediaKey = String(
    item?.vod_id || item?.vod_name || itemName.value || playUrl
  )
  const record = {
    ...(item || {}),
    item,
    epName: ext?.name || '正在播放',
    url: playUrl,
    progress: getMediaProgress(playUrl),
    groupLabel:
      sources.currentSourceType.value === 'catspider' ? '插件源' : 'CMS',
    timestamp: Date.now(),
  }
  const history = readStoredArray<Record<string, any>>(HISTORY_KEY)
  saveStoredArray(HISTORY_KEY, mergeOnlineHistory(history, record, mediaKey))
}

/** 播放一集：插件线路先解析地址，再预解析跳转 / 页面内 m3u8，然后打开独立播放窗。 */
const playEp = async (url: string, ext?: Record<string, any>) => {
  const generation = ++playGeneration
  currentUrl.value = ''
  let playUrl = url
  const siteName = sources.currentSiteName.value
  if (sources.currentSourceType.value === 'catspider' && siteName && ext) {
    const resolved = await resolvePlayUrl(siteName, ext)
    if (generation !== playGeneration) return
    if (resolved) playUrl = resolved
  }
  // 预解析跳转/页面内 m3u8，便于 Electron 独立窗口直接播放
  playUrl = await resolvePageToMedia(playUrl)
  if (generation !== playGeneration) return

  currentUrl.value = playUrl
  recordHistory(playUrl, ext)
  const title =
    [itemName.value, ext?.name].filter(Boolean).join(' · ') ||
    itemName.value ||
    '正在播放'
  // Electron 下强制独立播放窗；非 Electron（纯网页）才用页内播放层
  if (!canOpenElectronPlayer()) {
    showPlaySheet.value = true
    return
  }
  // 带上当前线路的剧集队列与同集备用线路：播放器据此自动连播/失败换线路
  const playlist = buildPlaylist(sources.currentLine.value)
  const epIndex = playlist.findIndex(item => item.url === url)
  const fallbacks = buildFallbacks(
    sources.siteGroups.value,
    sources.currentLine.value,
    ext?.name || '',
    epIndex
  )
  const ok = await openMediaPlayer({
    url: playUrl,
    title,
    poster: itemPic.value || undefined,
    startAt: getMediaProgress(playUrl),
    ...(playlist.length ? { playlist, index: epIndex >= 0 ? epIndex : 0 } : {}),
    ...(fallbacks.length ? { fallbacks } : {}),
  })
  showPlaySheet.value = false
  if (!ok) toast.error('无法打开独立播放窗口，请完全重启应用后再试')
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
  background: var(--bg-base);
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
  position: relative;
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
  background: linear-gradient(to bottom, transparent 20%, var(--bg-base) 100%);
}

.dw-content {
  position: relative;
  margin-top: -260px; /* style-tokens: layout（内容上移盖住背景图） */
  padding: 0 var(--content-padding-x) var(--space-9);
}

/* 播放弹窗 */
.sheet-fade-enter-active,
.sheet-fade-leave-active {
  transition: opacity var(--duration-normal);
}

.sheet-fade-enter-from,
.sheet-fade-leave-to {
  opacity: 0;
}

.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
  background: var(--overlay-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
}

.play-sheet {
  width: min(1200px, 92vw);
  height: 78vh;
  max-height: 92vh;
  background: var(--bg-elevated);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

.player-wrap {
  flex: 1;
  min-height: 0;
  height: 100%;
  background: var(--media-bg);
}
</style>
