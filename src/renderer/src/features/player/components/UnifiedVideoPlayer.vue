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
  </div>
</template>

<script setup lang="ts">
/**
 * 统一播放器：Artplayer 外壳 + hls.js（HLS）+ 字幕（本地自动挂载 / 在线搜索）+ 续播与倍速记忆。
 * 构造参数与纯规则在 utils/art-options.ts，字幕在 usePlayerSubtitles，这里只管加载、销毁与事件转发。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Artplayer from 'artplayer'
import Hls from 'hls.js'

import UiIconButton from '@/components/ui/UiIconButton.vue'
import { getSetting, setSetting } from '@/features/settings'

import { usePlayerSubtitles } from '../composables/use-player-subtitles'
import {
  applyPlaybackRate,
  artOptions,
  isHlsUrl,
  isValidPlaybackRate,
  shouldResume,
} from '../utils/art-options'
import { createHlsSession } from '../utils/hls-session'
import PlayerLoadingCover from './PlayerLoadingCover.vue'
import SubtitleSearchPanel from './SubtitleSearchPanel.vue'

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

let art: Artplayer | null = null
let loadToken = 0
let pendingSeek = 0

/** 上一次使用的播放倍速（跨会话记忆，设置 player.playbackRate） */
const readStoredRate = (): number => getSetting('player.playbackRate')

const subtitles = usePlayerSubtitles({
  player: () => art,
  search: () => ({
    title: props.subtitleSearchTitle || props.title || '',
    imdbId: props.subtitleImdbId,
    season: props.subtitleSeason,
    episode: props.subtitleEpisode,
  }),
})

const storeRate = (rate: number): void => {
  if (isValidPlaybackRate(rate)) void setSetting('player.playbackRate', rate)
}

const hlsSession = createHlsSession()

const destroyPlayer = (): void => {
  hlsSession.destroy()
  subtitles.dispose()
  if (art) {
    try {
      art.destroy(false)
    } catch {
      // ignore
    }
    art = null
  }
  video.value = null
}

const posterSrc = computed(() => props.poster?.trim() || '')

const hideLoading = (): void => {
  isLoading.value = false
}

const applySeekIfNeeded = (videoEl: HTMLVideoElement): void => {
  if (!shouldResume(pendingSeek, videoEl.duration)) return
  try {
    videoEl.currentTime = pendingSeek
  } catch {
    // ignore
  }
  pendingSeek = 0
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
  const useHls = Hls.isSupported() && isHlsUrl(resolved)

  // HLS 走 hls.js 自定义类型；其余格式交给 Artplayer 按扩展名自动识别。
  // 注意：Artplayer 5.x 会校验 type/customType 的类型，传 undefined 会在构造函数
  // 直接抛错（option.customType require 'object'），导致本地文件与直链 mp4/flv
  // 连 <video> 都创建不出来——因此这两项只在 HLS 时通过展开提供。
  const hlsCustomType = useHls
    ? hlsSession.customType({
        onManifestParsed: videoEl => {
          applySeekIfNeeded(videoEl)
          if (props.autoplay) videoEl.play().catch(() => {})
        },
        onFatalError: instance => {
          hideLoading()
          emit('error', new Event('error'))
          instance.notice.show = '播放失败'
        },
      })
    : null

  // 不把 poster 交给 Artplayer 常驻层，避免播放时黑边透出封面
  art = new Artplayer(
    artOptions({
      container: containerEl.value,
      url: resolved,
      autoplay: props.autoplay,
      controls: props.controls,
      hls: useHls ? hlsCustomType : null,
    })
  )

  video.value = art.video
  emit('ready', art.video)

  // 恢复上次使用的倍速，并记住本次改动（跨集/跨会话）
  // 注意：video.load() 会把 playbackRate 重置为 defaultPlaybackRate，故两者都要设，
  // 并在每次 loadedmetadata 时重新应用，保证自动连播换集后倍速不丢。
  const initialRate = readStoredRate()
  applyPlaybackRate(art.video, initialRate)
  art.on('video:ratechange', () => {
    if (art?.video) storeRate(art.video.playbackRate)
  })

  // 本地视频：自动挂载同目录字幕（srt/ass/vtt，含 GBK 编码转换）
  void subtitles.applyLocal(art, resolved)

  art.on('video:loadedmetadata', (event: Event) => {
    if (art?.video) applySeekIfNeeded(art.video)
    emit('loadedmetadata', event)
  })
  art.on('video:playing', () => hideLoading())
  art.on('video:play', (event: Event) => {
    hideLoading()
    emit('play', event)
  })
  art.on('video:timeupdate', (event: Event) => {
    const el = art?.video
    if (el && el.currentTime > 0.2) hideLoading()
    emit('timeupdate', event)
  })
  art.on('video:volumechange', (event: Event) => emit('volumechange', event))
  art.on('video:error', () => {
    hideLoading()
    emit('error', new Event('error'))
  })
  art.on('video:ended', (event: Event) => emit('ended', event))
  art.on('video:pause', (event: Event) => emit('pause', event))

  const onKeydown = (event: KeyboardEvent): void => {
    emit('keydown', event)
  }
  art.template.$player.addEventListener('keydown', onKeydown)
  art.on('destroy', () => {
    art?.template?.$player?.removeEventListener('keydown', onKeydown)
  })
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
