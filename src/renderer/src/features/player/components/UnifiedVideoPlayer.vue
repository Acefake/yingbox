<template>
  <div
    class="unified-player"
    :class="{
      'unified-player--no-controls': !controls,
      'unified-player--compact': compact,
    }"
    @click.stop
  >
    <div class="unified-player-stage">
      <div ref="containerEl" class="unified-player-video-area" />
      <!-- 仅加载中显示自适应海报；开播后纯黑，不留背景 -->
      <PlayerLoadingCover v-if="isLoading" :poster="posterSrc" />
      <RecapLayer
        :source="currentSource"
        :private="aiPrivate"
        :start-at="startAt"
        :player="artInstance"
        :compact="compact"
      />
    </div>
    <div v-if="showFooter && (closable || title)" class="unified-player-footer">
      <span class="unified-player-title">{{ title || '正在播放' }}</span>
      <div class="unified-player-footer-actions">
        <UiIconButton
          icon="subtitle"
          label="在线字幕"
          size="sm"
          :active="subtitles.panelOpen.value"
          @click="toggleSubtitlePanel"
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
    >
      <AiSubtitleSection :state="aiSubtitle" />
    </SubtitleSearchPanel>
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
import type Artplayer from 'artplayer'
import Hls from 'hls.js'

import UiIconButton from '@/components/ui/UiIconButton.vue'

import AiSubtitleSection from '../ai-subtitle/AiSubtitleSection.vue'
import { useAiSubtitle } from '../ai-subtitle/use-ai-subtitle'
import RecapLayer from '../recap/RecapLayer.vue'
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
import { closePlaybackInfo } from '../playback-info/playback-info'
import { installSeekThumbnails } from '../seek-thumbnails/seek-thumbnails'
import { installSettingsMenu } from '../settings-menu/install-menu'
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
    /** 来自私密板块：AI 字幕的翻译 / 云端转写只发给本地模型（按设置） */
    aiPrivate?: boolean
    /** 缩在小窗里：前情提要提示卡不挂，问剧情面板按容器收窄，字幕 / 弹幕面板与播放信息不打开 */
    compact?: boolean
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
    aiPrivate: false,
    compact: false,
    danmakuTarget: null,
    hls: false,
  }
)

const emit = defineEmits<{
  (name: 'ready', video: HTMLVideoElement): void
  /** 新建的 Artplayer 实例（每次换地址一个；外层据此挂右键菜单、进度条标记等） */
  (name: 'art', art: Artplayer): void
  (name: 'loadedmetadata', event: Event): void
  (name: 'timeupdate', event: Event): void
  (name: 'volumechange', event: Event): void
  (name: 'error', event: Event): void
  (name: 'ended', event: Event): void
  (name: 'play', event: Event): void
  (name: 'pause', event: Event): void
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

/** 当前实例的播放地址（解析后；AI 字幕据此判断是否本地文件） */
const currentSource = ref('')

const aiSubtitle = useAiSubtitle({
  source: () => currentSource.value,
  isPrivate: () => props.aiPrivate,
  title: () => props.subtitleSearchTitle || props.title || '',
  load: (path, name) => subtitles.applyFile(path, name),
})

/** 当前 Artplayer 实例（前情提要 / 问剧情读进度、加菜单入口） */
const artInstance = (): ArtCore['art'] | null => core?.art ?? null

/** 小窗里放不下的面板一律不打开，给一句提示（展开后再从控制栏打开） */
const blockedByCompact = (): boolean => {
  if (!props.compact) return false
  if (core) core.art.notice.show = '展开播放器后再打开'
  return true
}
const openSubtitlePanel = (): void => {
  if (blockedByCompact()) return
  if (!subtitles.panelOpen.value) subtitles.togglePanel()
}
/** 底栏「在线字幕」按钮：关闭总是允许，打开受小窗限制 */
const toggleSubtitlePanel = (): void => {
  if (subtitles.panelOpen.value) subtitles.togglePanel()
  else openSubtitlePanel()
}
const danmaku = useDanmaku({ target: () => props.danmakuTarget })
const openDanmakuPanel = (): void => {
  if (!blockedByCompact()) danmaku.openPanel()
}

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
  subtitles: openSubtitlePanel,
  compact: () => props.compact,
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
  currentSource.value = ''
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
  })
  containerEl.value.appendChild(core.node)
  video.value = core.art.video
  emit('ready', core.art.video)
  currentSource.value = resolved
  installSettingsMenu(core.art, {
    subtitles: {
      tracks: subtitles.tracks,
      active: subtitles.active,
      select: subtitles.selectTrack,
      openPanel: openSubtitlePanel,
    },
    danmaku:
      props.danmakuTarget && danmakuSupported()
        ? {
            enabled: danmaku.enabled,
            toggle: danmaku.toggle,
            openPanel: openDanmakuPanel,
          }
        : null,
    hls: () => core?.hls.instance() ?? null,
  })
  emit('art', core.art)

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

// 缩进角落小窗：字幕、弹幕面板和播放信息比小窗还大，收起来（展开后从控制栏再打开）
watch(
  () => props.compact,
  compact => {
    if (compact && core) closePlaybackInfo(core.art)
  }
)
// 小窗期间面板保持收起：入口已拦住，这里兜住其它途径（如开弹幕时没匹配自动弹出搜索）
watch(
  () =>
    props.compact &&
    (subtitles.panelOpen.value || danmaku.state.panelOpen.value),
  overflow => {
    if (!overflow) return
    subtitles.panelOpen.value = false
    danmaku.state.panelOpen.value = false
  },
  { immediate: true }
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

/** 字幕开关（快捷键 C）：挂着字幕时切显示，没有字幕时打开在线字幕面板 */
const toggleSubtitle = (): void => {
  const art = core?.art
  if (!art) return
  if (!subtitles.active.value) {
    openSubtitlePanel()
    return
  }
  art.subtitle.show = !art.subtitle.show
  art.notice.show = art.subtitle.show ? '字幕：开' : '字幕：关'
}

defineExpose({ video, toggleSubtitle })
</script>

<style scoped src="./unified-video-player.css"></style>
