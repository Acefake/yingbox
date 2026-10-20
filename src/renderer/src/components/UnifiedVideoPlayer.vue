<template>
  <div
    class="unified-player"
    :class="{ 'unified-player--no-controls': !controls }"
    @click.stop
  >
    <div class="unified-player-stage">
      <div ref="containerEl" class="unified-player-video-area" />
      <!-- 仅加载中显示自适应海报；开播后纯黑，不留背景 -->
      <div
        v-if="showLoadingPoster"
        class="unified-player-loading"
        aria-hidden="true"
      >
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
      <div class="unified-player-footer-actions">
        <button
          type="button"
          class="unified-player-subtitle-btn"
          title="在线字幕"
          @click="toggleSubtitlePanel"
        >
          字
        </button>
        <button
          v-if="closable"
          type="button"
          class="unified-player-close"
          aria-label="关闭播放器"
          @click="$emit('close')"
        >
          ×
        </button>
      </div>
    </div>
    <!-- 在线字幕搜索面板 -->
    <div v-if="subtitlePanelOpen" class="unified-player-subtitle-panel">
      <DialogTitlebar title="在线字幕 (OpenSubtitles)" icon="subtitle" @close="subtitlePanelOpen = false" />
      <div class="usp-search-row">
        <input
          v-model="subtitleQuery"
          class="usp-input"
          placeholder="影视名称…"
          @keydown.enter="doSubtitleSearch"
        />
        <button
          type="button"
          class="usp-btn"
          :disabled="subtitleSearching"
          @click="doSubtitleSearch"
        >
          {{ subtitleSearching ? '搜索中…' : '搜索' }}
        </button>
      </div>
      <p v-if="subtitleMessage" class="usp-msg">{{ subtitleMessage }}</p>
      <div class="usp-list">
        <button
          v-for="hit in subtitleHits"
          :key="hit.fileId"
          type="button"
          class="usp-item"
          :disabled="subtitleDownloadingId === hit.fileId"
          @click="applyOnlineSubtitle(hit)"
        >
          <span class="usp-item-name">{{ hit.name }}</span>
          <span class="usp-item-meta">
            ↓{{ hit.downloads
            }}<template v-if="hit.rating"> · ★{{ hit.rating }}</template> ·
            {{ hit.format }}
            {{ subtitleDownloadingId === hit.fileId ? '· 下载中…' : '' }}
          </span>
        </button>
        <p
          v-if="
            !subtitleSearching && subtitleHits.length === 0 && subtitleMessage
          "
          class="usp-empty"
        >
          无结果
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Artplayer from 'artplayer'
import Hls from 'hls.js'

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

// ── 在线字幕（OpenSubtitles）────────────────────────────
interface OnlineSubtitleHit {
  name: string
  language: string
  downloads: number
  rating?: number
  size?: number
  format: string
  fileId: number
}

const subtitlePanelOpen = ref(false)
const subtitleQuery = ref('')
const subtitleHits = ref<OnlineSubtitleHit[]>([])
const subtitleSearching = ref(false)
const subtitleDownloadingId = ref<number | null>(null)
const subtitleMessage = ref('')

const toggleSubtitlePanel = (): void => {
  subtitlePanelOpen.value = !subtitlePanelOpen.value
  if (subtitlePanelOpen.value && !subtitleHits.value.length) {
    // 首次打开自动用标题搜一次
    doSubtitleSearch()
  }
}

const doSubtitleSearch = async (): Promise<void> => {
  const api = window.api?.subtitle
  if (!api?.searchOnline) {
    subtitleMessage.value = '当前环境不支持在线字幕（需 Electron）'
    return
  }
  const query = (
    subtitleQuery.value ||
    props.subtitleSearchTitle ||
    props.title ||
    ''
  ).trim()
  if (!query) {
    subtitleMessage.value = '请输入影视名称'
    return
  }
  subtitleSearching.value = true
  subtitleMessage.value = ''
  subtitleHits.value = []
  try {
    const result = await api.searchOnline({
      query,
      imdbId: props.subtitleImdbId || undefined,
      season: props.subtitleSeason,
      episode: props.subtitleEpisode,
    })
    if (!result?.success) {
      subtitleMessage.value = result?.notConfigured
        ? '未配置 API key：在启动环境设置 YINGBOX_OPENSUBTITLES_KEY 后重启应用'
        : result?.error || '搜索失败'
      return
    }
    subtitleHits.value = result.data || []
    if (!subtitleHits.value.length) subtitleMessage.value = '无结果'
  } catch (error) {
    subtitleMessage.value = (error as Error).message
  } finally {
    subtitleSearching.value = false
  }
}

/** 下载并挂载在线字幕（与本地字幕共用同一 blob 挂载链路） */
const applyOnlineSubtitle = async (hit: OnlineSubtitleHit): Promise<void> => {
  const api = window.api?.subtitle
  const instance = art
  if (!api?.downloadOnline || !instance) return
  subtitleDownloadingId.value = hit.fileId
  try {
    const downloaded = await api.downloadOnline(hit.fileId)
    if (!downloaded?.success || !downloaded.data) {
      subtitleMessage.value = downloaded?.notConfigured
        ? '未配置 API key：设置 YINGBOX_OPENSUBTITLES_KEY 后重启应用'
        : downloaded?.error || '下载失败'
      return
    }
    if (art !== instance) return
    disposeSubtitleUrl()
    subtitleObjectUrl = URL.createObjectURL(
      new Blob([downloaded.data], { type: 'text/vtt' })
    )
    await instance.subtitle.switch(subtitleObjectUrl, {
      name: hit.name,
      type: 'vtt',
    })
    instance.notice.show = `字幕：${hit.name}`
    subtitlePanelOpen.value = false
  } catch (error) {
    subtitleMessage.value = (error as Error).message
  } finally {
    subtitleDownloadingId.value = null
  }
}

/**
 * 为本地视频自动挂载同目录字幕。
 *
 * 字幕文件可能是 GBK 编码的 srt/ass，由主进程统一读成 WebVTT 后
 * 以 blob URL 交给 Artplayer（避免 local:// 跨源读取限制）。
 */
const applyLocalSubtitles = async (
  instance: Artplayer,
  source: string
): Promise<void> => {
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
      subtitleObjectUrl = URL.createObjectURL(
        new Blob([read.data], { type: 'text/vtt' })
      )
      await instance.subtitle.switch(subtitleObjectUrl, {
        name: item.name,
        type: 'vtt',
      })
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
        selector: list.map(item => ({
          html: item.name,
          subtitlePath: item.path,
        })),
        onSelect(
          this: Artplayer,
          item: { html: string; subtitlePath?: string }
        ) {
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

  pendingSeek =
    typeof props.startAt === 'number' && props.startAt > 0 ? props.startAt : 0
  const useHls = Hls.isSupported() && isHlsUrl(resolved)

  // HLS 走 hls.js 自定义类型；其余格式交给 Artplayer 按扩展名自动识别。
  // 注意：Artplayer 5.x 会校验 type/customType 的类型，传 undefined 会在构造函数
  // 直接抛错（option.customType require 'object'），导致本地文件与直链 mp4/flv
  // 连 <video> 都创建不出来——因此这两项只在 HLS 时通过展开提供。
  const hlsCustomType = useHls
    ? {
        m3u8(
          videoEl: HTMLVideoElement,
          url: string,
          instance: Artplayer
        ): void {
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
    : null

  // 不把 poster 交给 Artplayer 常驻层，避免播放时黑边透出封面
  art = new Artplayer({
    container: containerEl.value,
    url: resolved,
    poster: '',
    theme: '#f5f5f7',
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
    // Artplayer 5.x 校验 option.type 必须是字符串：传 undefined 会在构造时抛错，
    // 导致非 HLS（本地文件、直链 mp4/flv）根本无法创建播放器。空串即沿用
    // Artplayer 默认的按扩展名自动识别。
    ...(useHls && hlsCustomType
      ? { type: 'm3u8', customType: hlsCustomType }
      : {}),
  })

  video.value = art.video
  emit('ready', art.video)

  // 恢复上次使用的倍速，并记住本次改动（跨集/跨会话）
  // 注意：video.load() 会把 playbackRate 重置为 defaultPlaybackRate，故两者都要设，
  // 并在每次 loadedmetadata 时重新应用，保证自动连播换集后倍速不丢。
  const initialRate = readStoredRate()
  const applyRate = (
    el: HTMLVideoElement | null | undefined,
    rate: number
  ): void => {
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
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
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
  to {
    transform: rotate(360deg);
  }
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
  gap: 8px;
  flex: 0 0 auto;
}

.unified-player-subtitle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: var(--bg-fill-secondary);
  cursor: pointer;
  font-size: var(--text-sm);
  line-height: 1;
}

.unified-player-subtitle-btn:hover {
  color: var(--text-primary);
  background: var(--bg-glass-hover);
}

.unified-player-subtitle-panel {
  position: absolute;
  right: 12px;
  bottom: 56px;
  z-index: 30;
  width: min(360px, 86vw);
  max-height: min(420px, 60vh);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  color: var(--text-primary, #fff);
  overflow: hidden;

  backdrop-filter: none;
}

.usp-search-row {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
}

.usp-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--separator, rgba(255, 255, 255, 0.12));
  background: var(--bg-fill-secondary, rgba(255, 255, 255, 0.06));
  color: inherit;
  font-size: var(--text-xs);
  outline: none;
}

.usp-input:focus {
  border-color: var(--accent, #007aff);
}

.usp-btn {
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--accent, #007aff);
  color: #fff;
  font-size: var(--text-xs);
  cursor: pointer;
  white-space: nowrap;
}

.usp-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.usp-msg {
  margin: 0 12px 8px;
  font-size: var(--text-2xs);
  color: var(--text-tertiary, #999);
}

.usp-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 10px;
}

.usp-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  margin-bottom: 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--bg-fill-secondary, rgba(255, 255, 255, 0.05));
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.usp-item:hover {
  background: var(--bg-glass-hover, rgba(255, 255, 255, 0.12));
}

.usp-item:disabled {
  opacity: 0.6;
  cursor: default;
}

.usp-item-name {
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usp-item-meta {
  font-size: var(--text-2xs);
  color: var(--text-tertiary, #888);
}

.usp-empty {
  margin: 8px 4px;
  font-size: var(--text-2xs);
  color: var(--text-tertiary, #888);
  text-align: center;
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
  font-size: var(--text-xl);
  line-height: 1;
}

.unified-player-close:hover {
  color: var(--text-primary);
  background: var(--bg-glass-hover);
}
</style>
