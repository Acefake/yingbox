<template>
  <div
    class="unified-player"
    :class="{ 'unified-player--no-controls': !controls }"
    @click.stop
  >
    <div class="unified-player-stage">
      <div ref="containerEl" class="unified-player-video-area" />
      <!-- 仅加载中显示自适应海报；开播后纯黑，不留背景 -->
      <PlayerLoadingCover v-if="isLoading" :poster="posterSrc" />
    </div>
    <div v-if="showFooter && (closable || title)" class="unified-player-footer">
      <span class="unified-player-title">{{ title || '正在播放' }}</span>
      <div class="unified-player-footer-actions">
        <UiIconButton
          icon="subtitle"
          label="在线字幕"
          size="sm"
          :active="subtitles.panelOpen.value"
          @click="subtitles.togglePanel"
        />
        <UiIconButton
          v-if="closable"
          icon="close"
          label="关闭播放器"
          size="sm"
          @click="$emit('close')"
        />
      </div>
    </div>
    <!-- 在线字幕搜索面板 -->
    <SubtitleSearchPanel
      v-show="subtitles.panelOpen.value"
      v-model:query="subtitles.query.value"
      :hits="subtitles.hits.value"
      :searching="subtitles.searching.value"
      :downloading-id="subtitles.downloadingId.value"
      :message="subtitles.message.value"
      @search="subtitles.search"
      @pick="subtitles.applyOnline"
      @close="subtitles.panelOpen.value = false"
    />
    <DanmakuPanel
      v-if="danmaku.state.panelOpen.value"
      :state="danmaku.state"
      @close="danmaku.state.panelOpen.value = false"
      @query="danmaku.setQuery"
      @search="danmaku.search"
      @bind="danmaku.bind"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 统一播放器：Artplayer 外壳 + hls.js（HLS）+ 字幕（本地自动挂载 / 在线搜索）+ 续播与倍速记忆。
 * 实例在 utils/art-core.ts（可交接），构造参数与纯规则在 utils/art-options.ts，字幕在 usePlayerSubtitles；
 * 这里只管加载、销毁与事件转发。缩成小窗时整个组件随播放弹窗的节点一起搬走，实例不重建。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Hls from 'hls.js'

import UiIconButton from '@/components/ui/UiIconButton.vue'

import { usePlayerSubtitles } from '../composables/use-player-subtitles'
import DanmakuPanel from '../danmaku/DanmakuPanel.vue'
import type { DanmakuTarget } from '../danmaku/danmaku-rules'
import { danmakuSupported } from '../danmaku/danmaku-store'
import { useDanmaku } from '../danmaku/use-danmaku'
import {
  type ArtCore,
  type ArtSink,
  createArtCore,
  destroyArtCore,
} from '../utils/art-core'
import { installSeekThumbnails } from '../seek-thumbnails/seek-thumbnails'
import { isHlsUrl, shouldResume } from '../utils/art-options'
import PlayerLoadingCover from './PlayerLoadingCover.vue'
import SubtitleSearchPanel from './SubtitleSearchPanel.vue'
import '../styles/art-skin.css'
import '../danmaku/danmaku.css'

const props = withDefaults(
  defineProps<{
    src?: string
    poster?: string
    title?: string
    closable?: boolean
    autoplay?: boolean
    controls?: boolean
    showFooter?: boolean
    /** Resume seconds */
    startAt?: number
    resolveUrl?: (url: string) => Promise<string>
    /** 在线字幕搜索关键词（无则用 title） */
    subtitleSearchTitle?: string
    /** 在线字幕的 IMDB id（有则大幅提高匹配精度） */
    subtitleImdbId?: string
    /** 在线字幕季/集（剧集用） */
    subtitleSeason?: number
    subtitleEpisode?: number
    /** 弹幕匹配用的当前条目；不传则不显示弹幕 */
    danmakuTarget?: DanmakuTarget | null
    /** 强制按 HLS 播放（直播接口地址常不带 .m3u8 扩展名） */
    hls?: boolean
  }>(),
  {
    src: '',
    poster: '',
    title: '',
    closable: true,
    autoplay: true,
    controls: true,
    showFooter: true,
    startAt: 0,
    subtitleSearchTitle: '',
    subtitleImdbId: '',
    subtitleSeason: undefined,
    subtitleEpisode: undefined,
    danmakuTarget: null,
    hls: false,
  }
)

const emit = defineEmits<{
  (name: 'ready', video: HTMLVideoElement): void
  (name: 'loadedmetadata', event: Event): void
  (name: 'timeupdate', event: Event): void
  (name: 'volumechange', event: Event): void
  (name: 'error', event: Event): void
  (name: 'ended', event: Event): void
  (name: 'play', event: Event): void
  (name: 'pause', event: Event): void
  (name: 'keydown', event: KeyboardEvent): void
  (name: 'close'): void
}>()

const containerEl = ref<HTMLDivElement | null>(null)
const video = ref<HTMLVideoElement | null>(null)
const isLoading = ref(false)

/** 当前持有的实例 */
let core: ArtCore | null = null
let loadToken = 0
let pendingSeek = 0

const subtitles = usePlayerSubtitles({
  player: () => core?.art ?? null,
  search: () => ({
    title: props.subtitleSearchTitle || props.title || '',
    imdbId: props.subtitleImdbId,
    season: props.subtitleSeason,
    episode: props.subtitleEpisode,
  }),
})

const danmaku = useDanmaku({ target: () => props.danmakuTarget })

const posterSrc = computed(() => props.poster?.trim() || '')

/** 本组件作为实例的事件去向 */
const sink: ArtSink = {
  event: (name, event) => {
    // emit 的重载按事件名区分，这几种事件的载荷都是 Event
    ;(emit as (n: typeof name, e: Event) => void)(name, event)
  },
  error: () => {
    isLoading.value = false
    emit('error', new Event('error'))
  },
  keydown: event => emit('keydown', event),
  started: () => {
    isLoading.value = false
  },
  seek: videoEl => {
    if (!shouldResume(pendingSeek, videoEl.duration)) return
    try {
      videoEl.currentTime = pendingSeek
    } catch {
      // ignore
    }
    pendingSeek = 0
  },
  autoplay: () => props.autoplay,
  subtitles: () => {
    if (!subtitles.panelOpen.value) subtitles.togglePanel()
  },
}

/** 拆掉实例（连同字幕 blob） */
const destroyPlayer = (): void => {
  if (core) {
    subtitles.dispose()
    danmaku.detach()
    destroyArtCore(core)
  }
  core = null
  video.value = null
}

const createPlayer = async (source: string): Promise<void> => {
  const container = containerEl.value
  if (!container) return

  const token = ++loadToken
  destroyPlayer()
  if (!source) {
    isLoading.value = false
    return
  }
  isLoading.value = true

  let resolved: string
  try {
    resolved = props.resolveUrl ? await props.resolveUrl(source) : source
    if (!resolved) throw new Error('未获取到播放地址')
  } catch {
    if (token === loadToken) {
      isLoading.value = false
      emit('error', new Event('error'))
    }
    return
  }
  if (token !== loadToken || !containerEl.value) return

  pendingSeek =
    typeof props.startAt === 'number' && props.startAt > 0 ? props.startAt : 0

  // 不把 poster 交给 Artplayer 常驻层，避免播放时黑边透出封面
  core = createArtCore({
    url: resolved,
    useHls: Hls.isSupported() && (props.hls || isHlsUrl(resolved)),
    autoplay: props.autoplay,
    controls: props.controls,
    sink,
    extraControls:
      props.danmakuTarget && danmakuSupported() ? [danmaku.control()] : [],
  })
  containerEl.value.appendChild(core.node)
  video.value = core.art.video
  emit('ready', core.art.video)

  if (props.danmakuTarget) void danmaku.attach(core.art)

  // 本地视频：自动挂载同目录字幕（srt/ass/vtt，含 GBK 编码转换）
  void subtitles.applyLocal(core.art, resolved)
  // 本地视频：进度条悬停缩略图（主进程 ffmpeg 后台生成，没有 ffmpeg 时不显示）
  installSeekThumbnails(core.art, resolved)
}

watch(
  () => props.src,
  source => {
    void createPlayer(source || '')
  }
)

watch(
  () => props.startAt,
  value => {
    if (typeof value === 'number' && value > 0) pendingSeek = value
  }
)

onMounted(async () => {
  await nextTick()
  if (props.src) void createPlayer(props.src)
})

onBeforeUnmount(() => {
  loadToken++
  destroyPlayer()
})

defineExpose({ video })
</script>

<style scoped>
.unified-player {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--media-bg);
  overflow: hidden;
}

.unified-player-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
  background: var(--media-bg);
}

.unified-player-video-area {
  position: absolute;
  inset: 0;
  background: var(--media-bg);
}

.unified-player-video-area :deep(.unified-player-core) {
  position: absolute;
  inset: 0;
}

.unified-player-video-area :deep(.artplayer-app),
.unified-player-video-area :deep(.art-video-player),
.unified-player-video-area :deep(.art-video),
.unified-player-video-area :deep(video) {
  width: 100% !important;
  height: 100% !important;
  background: var(--media-bg) !important;
}

.unified-player-video-area :deep(.art-poster) {
  display: none !important;
}

.unified-player--no-controls :deep(.art-controls),
.unified-player--no-controls :deep(.art-bottom),
.unified-player--no-controls :deep(.art-mask),
.unified-player--no-controls :deep(.art-notice) {
  display: none !important;
}

.unified-player-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  z-index: var(--z-raised);
  flex-shrink: 0;
  min-height: 48px;
  padding: 0 var(--space-4);
  color: var(--text-primary);
  background: var(--bg-main);
  border-top: 1px solid var(--border-default);
}

.unified-player-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}

.unified-player-footer-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
}
</style>
