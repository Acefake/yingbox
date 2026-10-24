<template>
  <div class="player-session">
    <UnifiedVideoPlayer
      v-if="src"
      :src="src"
      :poster="poster"
      :start-at="startAt"
      :danmaku-target="danmakuTarget"
      title=""
      :closable="false"
      :show-footer="false"
      autoplay
      controls
      @ready="media.attach"
      @art="art = $event"
      @play="clearFailure"
      @loadedmetadata="clearFailure"
      @timeupdate="progress.onTimeUpdate"
      @pause="progress.flush"
      @ended="onEnded"
      @error="onError"
    />
    <div
      v-else
      class="player-session-empty flex flex-col items-center justify-center gap-4"
    >
      <img v-if="poster" class="player-session-poster" :src="poster" alt="" />
      <span>{{ emptyText }}</span>
    </div>
    <SkipOverlay
      :art
      :series="skipKey(continueId, defaultTitle)"
      :up-next="
        playlist[position + 1] ? entryLabel(playlist[position + 1]) : ''
      "
      :play-next="playNext"
    />
    <p v-if="notice" class="player-session-notice">{{ notice }}</p>
    <!-- 播放失败：给出可操作的重试，而不是一闪而过的提示 -->
    <div v-if="failure" class="player-session-error" role="alert">
      <p class="player-session-error-title">播放失败</p>
      <p class="player-session-error-msg">{{ failure }}</p>
      <p
        v-if="failedSource"
        class="player-session-error-src"
        :title="failedSource"
      >
        {{ failedSource }}
      </p>
      <div class="player-session-error-actions">
        <UiButton
          variant="primary"
          icon="refresh"
          :label="retrying ? '重试中…' : '重试'"
          :loading="retrying"
          @click="retry"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 一次播放会话：收下播放队列（集 / 文件 / 备用线路），负责自动连播、失败 / 卡顿换源（useSourceSwitch）、
 * 续播进度、可操作的错误面板与跳过片头片尾（skip/）。队列解析与进度节流分别在 utils/play-queue、useProgressSaver。
 * 载荷换了（播别的）就重新开始；当前条目名、当前 <video> 通过 title / video 事件交给外层的播放弹窗。
 */
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type Artplayer from 'artplayer'
import UnifiedVideoPlayer from './UnifiedVideoPlayer.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { toLocalUrl } from '@/utils/local-url'
import { usePlayerMediaControls } from '../composables/use-media-controls'
import { useProgressSaver } from '../composables/use-progress-saver'
import { useSourceSwitch } from '../composables/use-source-switch'
import { danmakuTargetFor } from '../danmaku/danmaku-target'
import { updateContinue } from '../continue/continue-store'
import SkipOverlay from '../skip/SkipOverlay.vue'
import { skipKey } from '../skip/skip-rules'
import { consumeSleepAtEnd } from '../sleep/sleep-timer'
import { getMediaProgress, mediaProgressKey } from '../utils/play-progress'
import { singleFlight } from '../utils/single-flight'
import {
  type PlayerPayload,
  type PlaylistEntry,
  normalizePlayerPayload,
  playlistEntryLabel,
} from '../utils/play-queue'
import { resolvePlaySource } from '@/features/online'

const props = defineProps<{ payload: PlayerPayload }>()
const emit = defineEmits<{
  title: [title: string]
  /** 播放器的 <video>（每集换一个；小窗的播放 / 暂停控制它） */
  video: [video: HTMLVideoElement]
}>()

const src = ref('')
const poster = ref('')
const startAt = ref(0)
const progressKey = ref('')
const emptyText = ref('等待加载视频…')
/** 短暂提示（自动换线路 / 连播时可见） */
const notice = ref('')

/** 当前线路的播放队列（自动连播用） */
const playlist = ref<PlaylistEntry[]>([])
const position = ref(0)
/** 同集备用线路（失败自动换线路用） */
const fallbacks = ref<PlaylistEntry[]>([])
/** 当前使用的备用线路下标；-1 = 主线路 */
const activeFallback = ref(-1)
const defaultTitle = ref('正在播放')

/** 播放失败且已无备用线路时展示的可操作错误信息 */
const failure = ref('')
const failedSource = ref('')
const retrying = ref(false)

/** 「继续播放」记录 id（载荷带了才记） */
const continueId = ref('')

const progress = useProgressSaver(
  () => progressKey.value,
  Date.now,
  (time, duration, ended) => {
    // 只记主线路的位置：备用线路是同一集，下标不变
    updateContinue(continueId.value, {
      index: position.value,
      episode:
        playlist.value.length > 1
          ? entryLabel(playlist.value[position.value])
          : undefined,
      progress: time,
      duration,
      ended,
    })
  }
)
/** 加载世代：丢弃过期的异步解析结果 */
let loadToken = 0
let noticeTimer: number | undefined
const art = shallowRef<Artplayer | null>(null)

const currentEntry = computed<PlaylistEntry | null>(() => {
  if (activeFallback.value >= 0)
    return fallbacks.value[activeFallback.value] || null
  return playlist.value[position.value] || null
})

/** 弹幕匹配用的当前条目（规则见 danmakuTargetFor） */
const danmakuTarget = computed(() =>
  danmakuTargetFor({
    playlist: playlist.value,
    position: position.value,
    title: defaultTitle.value,
    current: currentEntry.value,
    label: entryLabel,
  })
)

const showNotice = (text: string): void => {
  notice.value = text
  if (noticeTimer) window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 4000)
}

/** 恢复播放后清掉错误面板 */
const clearFailure = (): void => {
  failure.value = ''
  failedSource.value = ''
}

const entryLabel = (entry: PlaylistEntry | null | undefined): string =>
  playlistEntryLabel(entry, defaultTitle.value)

/**
 * 加载当前条目。
 *
 * @param seeded 调用方已解析好的地址（起始集复用，避免二次解析）
 * @param seededStartAt 起始续播位置
 */
const loadEntry = async (
  seeded?: string,
  seededStartAt?: number
): Promise<void> => {
  const token = ++loadToken
  const entry = currentEntry.value
  progress.reset()
  clearFailure()

  if (!entry) {
    src.value = ''
    emptyText.value = '播放列表已结束'
    return
  }

  let resolved = ''
  if (entry.filePath) {
    resolved = toLocalUrl(entry.filePath)
    progressKey.value = mediaProgressKey({ filePath: entry.filePath })
  } else if (seeded || entry.url) {
    resolved = seeded || (await resolvePlaySource(entry))
    if (token !== loadToken) return
    progressKey.value = mediaProgressKey({ url: resolved })
  } else {
    src.value = ''
    emptyText.value = '无可用播放地址'
    failure.value = '这一集没有可用的播放地址。'
    failedSource.value = entryLabel(entry)
    return
  }

  if (!resolved) {
    src.value = ''
    emptyText.value = '无法解析播放地址'
    failure.value = '无法从该来源解析出播放地址（可能是资源已下架或需要登录）。'
    failedSource.value = entryLabel(entry)
    return
  }

  const stored = getMediaProgress(progressKey.value)
  startAt.value =
    typeof seededStartAt === 'number' && seededStartAt > 0
      ? seededStartAt
      : stored
  src.value = resolved
  emit('title', entryLabel(entry))
}

/** 自动连播：切到当前线路的下一集；解析地址期间再触发复用同一次，不会多跳一集 */
const playNext = singleFlight(async (): Promise<boolean> => {
  if (position.value + 1 >= playlist.value.length) return false
  activeFallback.value = -1
  position.value += 1
  await loadEntry()
  return true
})

const onEnded = async (event: Event): Promise<void> => {
  if (playNext.pending()) return // 切集中：旧视频自然结束不再记完播、不再切集
  if (!media.accepts(event)) return // 托盘 / 媒体键换集时退役的旧视频
  const el = event.target as HTMLVideoElement | null
  progress.markFinished(el)
  // 睡眠定时（看完本集 / 已到点）在连播前同步消费：停在本集
  if (consumeSleepAtEnd()) {
    showNotice('睡眠定时到了，已停止连播')
    return
  }
  const next = playlist.value[position.value + 1]
  if (next) {
    showNotice(`即将播放：${entryLabel(next)}`)
    await playNext()
    return
  }
  emptyText.value = '已播放完最后一集'
}

/** 卡顿 / 出错自动换到同集的下一条备用源，从当前进度继续 */
const switcher = useSourceSwitch({
  fallbacks,
  activeFallback,
  current: () => currentEntry.value,
  notify: showNotice,
  load: at => {
    progress.flush()
    return loadEntry(undefined, at)
  },
})

const onVideo = (video: HTMLVideoElement): void => {
  switcher.attach(video)
  emit('video', video)
}

/** 播放失败（含 hls 致命错误）：自动切换到同集的下一条备用源 */
const onError = async (event?: Event): Promise<void> => {
  if (!media.accepts(event)) return
  if (await switcher.switchSource('error')) return
  // 备用线路也失败：给出可操作的错误界面
  failure.value = fallbacks.value.length
    ? '当前线路与备用线路均无法播放。'
    : '无法播放该地址（可能是资源已失效或格式不受支持）。'
  failedSource.value = entryLabel(currentEntry.value)
  showNotice('播放失败')
}

/** 手动重试：重置备用线路，从当前集重新解析播放 */
const retry = async (): Promise<void> => {
  if (retrying.value) return
  retrying.value = true
  try {
    activeFallback.value = -1
    await loadEntry()
  } finally {
    retrying.value = false
  }
}

/** 托盘 / 媒体键 / 系统媒体控件 → 本会话 */
const media = usePlayerMediaControls({
  playlist,
  position,
  activeFallback,
  poster,
  load: loadEntry,
  title: () => entryLabel(currentEntry.value),
  onVideo,
})

const applyPayload = (payload: PlayerPayload): void => {
  const queue = normalizePlayerPayload(payload)
  if (!queue) return
  defaultTitle.value = queue.title
  playlist.value = queue.playlist
  position.value = queue.position
  fallbacks.value = queue.fallbacks
  activeFallback.value = -1
  poster.value = queue.poster
  continueId.value = queue.continueId
  // 起始项地址已由调用方解析过，直接复用以避免二次解析（url 始终对应 index 指向的那一集）
  void loadEntry(queue.seededUrl, queue.startAt)
}

watch(() => props.payload, applyPayload, { immediate: true })

onMounted(() => window.addEventListener('beforeunload', progress.flush))

onBeforeUnmount(() => {
  progress.flush()
  switcher.detach()
  window.removeEventListener('beforeunload', progress.flush)
  if (noticeTimer) window.clearTimeout(noticeTimer)
})
</script>

<style scoped src="./player-session.css"></style>
