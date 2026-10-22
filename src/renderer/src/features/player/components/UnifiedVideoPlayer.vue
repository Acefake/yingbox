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
 * 实例在 utils/art-core.ts（可交接），构造参数与纯规则在 utils/art-options.ts，字幕在 usePlayerSubtitles；
 * 这里只管加载、销毁、事件转发，以及应用内小窗的交接（离开详情时交出实例、回来时认领）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Hls from 'hls.js'

import UiIconButton from '@/components/ui/UiIconButton.vue'

import { usePlayerSubtitles } from '../composables/use-player-subtitles'
import { claimMini, dockMini, preemptMini } from '../mini/mini-dock'
import { useMiniHost } from '../mini/mini-host'
import {
  type ArtCore,
  type ArtSink,
  createArtCore,
  destroyArtCore,
} from '../utils/art-core'
import { isHlsUrl, shouldResume } from '../utils/art-options'
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

/** 当前持有的实例；交给小窗后为 null，docked 为 true */
let core: ArtCore | null = null
let docked = false
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
}

/** 拆掉自己持有的实例；交给小窗的实例（连同字幕 blob）不归这里，由小窗拆除 */
const destroyPlayer = (): void => {
  if (core) {
    subtitles.dispose()
    destroyArtCore(core)
  }
  core = null
  video.value = null
}

/** 认领一个实例：节点搬进自己的容器，事件改由本组件转发 */
const adopt = (claimed: ArtCore): void => {
  core = claimed
  docked = false
  claimed.sink.current = sink
  containerEl.value?.appendChild(claimed.node)
  video.value = claimed.art.video
  isLoading.value = false
}

/** 小窗交接：离开详情时交出播放中的实例，详情重新显示时认领回来 */
const host = useMiniHost({
  dock: () => {
    const current = core
    if (!current || !host) return false
    const ok = dockMini({
      key: props.src,
      title: props.title || '正在播放',
      node: current.node,
      video: current.art.video,
      payload: current,
      restore: host.restoreFn(),
      teardown: () => {
        destroyArtCore(current)
        docked = false
        emit('close')
      },
    })
    if (!ok) return false
    // 字幕 blob 跟实例走，最终拆除时再释放
    current.disposers.push(subtitles.dispose)
    core = null
    video.value = null
    docked = true
    return true
  },
  reclaim: () => {
    if (!docked) return
    const claimed = claimMini(props.src)
    if (claimed) adopt(claimed.payload as ArtCore)
  },
})

const createPlayer = async (source: string): Promise<void> => {
  const container = containerEl.value
  if (!container) return

  const token = ++loadToken
  destroyPlayer()
  docked = false
  if (!source) {
    isLoading.value = false
    return
  }
  // 小窗里正播着同一个地址：认领回来，不重建、不重新请求
  const claimed = claimMini(source)
  if (claimed) {
    adopt(claimed.payload as ArtCore)
    emit('ready', claimed.video)
    return
  }
  preemptMini(source)

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
    useHls: Hls.isSupported() && isHlsUrl(resolved),
    autoplay: props.autoplay,
    controls: props.controls,
    sink,
  })
  containerEl.value.appendChild(core.node)
  video.value = core.art.video
  emit('ready', core.art.video)

  // 本地视频：自动挂载同目录字幕（srt/ass/vtt，含 GBK 编码转换）
  void subtitles.applyLocal(core.art, resolved)
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
