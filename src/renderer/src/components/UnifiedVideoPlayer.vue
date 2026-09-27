<template>
  <div
    class="unified-player"
    :class="{ 'unified-player--no-controls': !controls }"
    @click.stop
  >
    <div class="unified-player-stage">
      <div ref="containerEl" class="unified-player-video-area" />
      <!-- 仅加载中显示自适应海报；开播后纯黑，不留背景 -->
      <div v-if="showLoadingPoster" class="unified-player-loading" aria-hidden="true">
        <img
          v-if="posterSrc"
          class="unified-player-loading-poster"
          :src="posterSrc"
          alt=""
          draggable="false"
        />
        <div class="unified-player-loading-spin" />
      </div>
    </div>
    <div v-if="showFooter && (closable || title)" class="unified-player-footer">
      <span class="unified-player-title">{{ title || '正在播放' }}</span>
      <button
        v-if="closable"
        type="button"
        class="unified-player-close"
        aria-label="关闭播放器"
        @click="$emit('close')"
      >×</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Artplayer from 'artplayer'
import Hls from 'hls.js'

const props = withDefaults(defineProps<{
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
}>(), {
  src: '',
  poster: '',
  title: '',
  closable: true,
  autoplay: true,
  controls: true,
  showFooter: true,
  startAt: 0,
})

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
let hls: Hls | null = null
let loadToken = 0
let pendingSeek = 0

/** 上一次使用的播放倍速（跨会话记忆） */
const PLAYBACK_RATE_KEY = 'player_playback_rate'

const readStoredRate = (): number => {
  const raw = Number(localStorage.getItem(PLAYBACK_RATE_KEY))
  return Number.isFinite(raw) && raw >= 0.25 && raw <= 4 ? raw : 1
}

const storeRate = (rate: number): void => {
  if (Number.isFinite(rate) && rate >= 0.25 && rate <= 4) {
    localStorage.setItem(PLAYBACK_RATE_KEY, String(rate))
  }
}

/** 本地字幕候选（同目录 .srt/.ass/.vtt） */
interface LocalSubtitle {
  name: string
  path: string
  ext: string
}

let subtitleObjectUrl: string | null = null

const disposeSubtitleUrl = (): void => {
  if (!subtitleObjectUrl) return
  URL.revokeObjectURL(subtitleObjectUrl)
  subtitleObjectUrl = null
}

const isLocalSource = (url: string): boolean => url.startsWith('local://')

/**
 * 为本地视频自动挂载同目录字幕。
 *
 * 字幕文件可能是 GBK 编码的 srt/ass，由主进程统一读成 WebVTT 后
 * 以 blob URL 交给 Artplayer（避免 local:// 跨源读取限制）。
 */
const applyLocalSubtitles = async (instance: Artplayer, source: string): Promise<void> => {
  const subtitleApi = window.api?.subtitle
  if (!subtitleApi || !isLocalSource(source)) return

  let list: LocalSubtitle[] = []
  try {
    const found = await subtitleApi.find(source)
    if (!found?.success || !Array.isArray(found.data)) return
    list = found.data
  } catch {
    return
  }
  // 等待期间可能已切集/销毁播放器，此时放弃挂载
  if (!list.length || art !== instance) return

  const switchTo = async (item: LocalSubtitle): Promise<boolean> => {
    if (art !== instance) return false
    try {
      const read = await subtitleApi.read(item.path)
      if (!read?.success || !read.data) return false
      if (art !== instance) return false
      disposeSubtitleUrl()
      subtitleObjectUrl = URL.createObjectURL(new Blob([read.data], { type: 'text/vtt' }))
      await instance.subtitle.switch(subtitleObjectUrl, { name: item.name, type: 'vtt' })
      return true
    } catch {
      return false
    }
  }

  // 默认加载最佳匹配（与视频同名者优先）
  const applied = await switchTo(list[0])
  if (!applied || art !== instance) return

  // 多个候选时提供字幕切换菜单；菜单失败不应影响已生效的字幕
  if (list.length > 1) {
    try {
      instance.setting.add({
        name: 'localSubtitle',
        html: '字幕',
        selector: list.map(item => ({ html: item.name, subtitlePath: item.path })),
        onSelect(this: Artplayer, item: { html: string; subtitlePath?: string }) {
          const target = list.find(sub => sub.path === item.subtitlePath)
          if (target) void switchTo(target)
          this.notice.show = `字幕：${item.html}`
        },
      })
    } catch {
      // ignore
    }
  }
}

const destroyHls = (): void => {
  if (!hls) return
  hls.destroy()
  hls = null
}

const destroyPlayer = (): void => {
  destroyHls()
  disposeSubtitleUrl()
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
const showLoadingPoster = computed(() => isLoading.value)

const hideLoading = (): void => {
  isLoading.value = false
}

const isHlsUrl = (url: string): boolean => /\.m3u8(?:$|\?)/i.test(url)

const applySeekIfNeeded = (videoEl: HTMLVideoElement): void => {
  const target = pendingSeek
  if (!(target > 5)) return
  const duration = videoEl.duration
  if (!Number.isFinite(duration) || duration <= 15) return
  if (target >= duration - 10) return
  try {
    videoEl.currentTime = target
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

  pendingSeek = typeof props.startAt === 'number' && props.startAt > 0 ? props.startAt : 0
  const useHls = Hls.isSupported() && isHlsUrl(resolved)

  // 不把 poster 交给 Artplayer 常驻层，避免播放时黑边透出封面
  art = new Artplayer({
    container: containerEl.value,
    url: resolved,
    poster: '',
    theme: '#007aff',
    volume: 1,
    autoplay: props.autoplay,
    muted: false,
    autoSize: false,
    autoMini: false,
    loop: false,
    flip: false,
    playbackRate: true,
    aspectRatio: false,
    screenshot: false,
    setting: true,
    hotkey: false,
    pip: false,
    mutex: true,
    backdrop: true,
    fullscreen: props.controls,
    fullscreenWeb: false,
    miniProgressBar: false,
    autoPlayback: false,
    lock: false,
    fastForward: false,
    autoOrientation: false,
    lang: 'zh-cn',
    moreVideoAttr: {
      playsInline: true,
      preload: 'auto',
    },
    type: useHls ? 'm3u8' : undefined,
    customType: useHls
      ? {
          m3u8(videoEl: HTMLVideoElement, url: string, instance: Artplayer) {
            destroyHls()
            hls = new Hls({ enableWorker: true })
            hls.loadSource(url)
            hls.attachMedia(videoEl)
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              applySeekIfNeeded(videoEl)
              if (props.autoplay) videoEl.play().catch(() => {})
            })
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal) {
                hideLoading()
                emit('error', new Event('error'))
                instance.notice.show = '播放失败'
              }
            })
            instance.on('destroy', () => {
              destroyHls()
            })
          },
        }
      : undefined,
  })

  video.value = art.video
  emit('ready', art.video)

  // 恢复上次使用的倍速，并记住本次改动（跨集/跨会话）
  // 注意：video.load() 会把 playbackRate 重置为 defaultPlaybackRate，故两者都要设，
  // 并在每次 loadedmetadata 时重新应用，保证自动连播换集后倍速不丢。
  const initialRate = readStoredRate()
  const applyRate = (el: HTMLVideoElement | null | undefined, rate: number): void => {
    if (!el || rate === 1) return
    try {
      el.defaultPlaybackRate = rate
      if (el.playbackRate !== rate) el.playbackRate = rate
    } catch {
      // ignore
    }
  }
  applyRate(art.video, initialRate)
  art.on('video:ratechange', () => {
    if (art?.video) storeRate(art.video.playbackRate)
  })

  // 本地视频：自动挂载同目录字幕（srt/ass/vtt，含 GBK 编码转换）
  void applyLocalSubtitles(art, resolved)

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
  (source) => {
    void createPlayer(source || '')
  }
)

watch(
  () => props.startAt,
  (value) => {
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
  background: #000;
  overflow: hidden;
}

.unified-player-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
  background: #000;
}

.unified-player-video-area {
  position: absolute;
  inset: 0;
  background: #000;
}

.unified-player-video-area :deep(.artplayer-app),
.unified-player-video-area :deep(.art-video-player),
.unified-player-video-area :deep(.art-video),
.unified-player-video-area :deep(video) {
  width: 100% !important;
  height: 100% !important;
  background: #000 !important;
}

.unified-player-video-area :deep(.art-poster) {
  display: none !important;
}

.unified-player-loading {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  pointer-events: none;
}

.unified-player-loading-poster {
  max-width: min(72%, 420px);
  max-height: min(78%, 72vh);
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}

.unified-player-loading-spin {
  position: absolute;
  bottom: 28px;
  width: 22px;
  height: 22px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  animation: unified-player-spin 0.8s linear infinite;
}

@keyframes unified-player-spin {
  to { transform: rotate(360deg); }
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
  z-index: 2;
  flex-shrink: 0;
  min-height: 48px;
  padding: 0 16px;
  color: var(--text-primary);
  background: var(--bg-elevated);
  border-top: 1px solid var(--separator);
}

.unified-player-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}

.unified-player-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 50%;
  color: var(--text-secondary);
  background: var(--bg-fill-secondary);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}

.unified-player-close:hover {
  color: var(--text-primary);
  background: var(--bg-glass-hover);
}
</style>