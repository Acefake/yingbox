<template>
  <div class="player-session" :class="{ 'is-failed': failure }">
    <UnifiedVideoPlayer
      v-if="src"
      ref="player"
      :src="src"
      :poster="poster"
      :start-at="startAt"
      :danmaku-target="danmakuTarget"
      :title="payload.title"
      :closable="false"
      :show-footer="false"
      :ai-private="payload.private === true"
      autoplay
      controls
      @ready="media.attach"
      @art="art = $event"
      @play="onPlay"
      @loadedmetadata="clearFailure"
      @timeupdate="progress.saver.onTimeUpdate"
      @pause="progress.saver.flush"
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
      :queue="playlist"
      :up-next="
        playlist[position + 1] ? entryLabel(playlist[position + 1]) : ''
      "
      :play-next="playNext"
      :ended="endedPrompt"
      :end-hint="endHint"
      @cancel-ended="endedPrompt = false"
      @close-hint="endHint = null"
    />
    <p v-if="notice" class="player-session-notice">{{ notice }}</p>
    <!-- 播放失败：给出可操作的重试 / 交给 mpv，而不是一闪而过的提示 -->
    <PlayerErrorPanel
      v-if="failure"
      :message="failure"
      :source="failedSource"
      :retrying
      :can-hand-off="canHandOff"
      :handing-off="handingOff"
      @retry="retry"
      @hand-off="mpvHandoff.handOff(true)"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 一次播放会话：收下播放队列（集 / 文件 / 备用线路），负责自动连播、失败 / 卡顿换源（useSourceSwitch）、
 * 续播进度、可操作的错误面板与跳过片头片尾（skip/）。队列解析与进度节流分别在 utils/play-queue、useProgressSaver。
 * 载荷换了（播别的）就重新开始；当前条目名、当前 <video> 通过 title / video 事件交给外层（播放器窗口 / 网页端播放层）。
 * 每集的 Artplayer 上装按钮、快捷键与双击手势（controls/、hotkeys/）和 AI 助手遥控（remote/）；播完有下一集时给倒计时卡片。
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
import { useSessionShortcuts } from '../controls/use-session-shortcuts'
import PlayerErrorPanel from './PlayerErrorPanel.vue'
import { usePlayerMediaControls } from '../composables/use-media-controls'
import { useSessionProgress } from '../composables/use-session-progress'
import { useSourceSwitch } from '../composables/use-source-switch'
import { useTimedNotice } from '../composables/use-timed-notice'
import { danmakuTargetFor } from '../danmaku/danmaku-target'
import SkipOverlay from '../skip/SkipOverlay.vue'
import { skipKey } from '../skip/skip-rules'
import { consumeSleepAtEnd } from '../sleep/sleep-timer'
import { useDolbyVision } from '../dolby-vision/use-dolby-vision'
import { usePlayerRemote } from '../remote/use-player-remote'
import { mediaProgressKey } from '../utils/play-progress'
import { singleFlight } from '../utils/single-flight'
import {
  type EndHint,
  type PlayerPayload,
  type PlaylistEntry,
  normalizePlayerPayload,
  playlistEntryLabel,
} from '../utils/play-queue'
import { resolvePlaySource } from '@/features/online'
import { useMpvHandoff } from '../composables/use-mpv-handoff'

const props = defineProps<{
  payload: PlayerPayload
  /** 切换窗口置顶（控制栏图钉 / 快捷键 I），返回切换后的状态；不给就没有这个按钮（网页端） */
  togglePin?: (() => boolean) | null
}>()
const emit = defineEmits<{
  title: [title: string]
  /** 播放器的 <video>（每集换一个；外层据此显示暂停时常显的顶栏） */
  video: [video: HTMLVideoElement]
}>()

const src = ref('')
const poster = ref('')
const startAt = ref(0)
const progressKey = ref('')
const emptyText = ref('等待加载视频…')
/** 短暂提示（自动换线路 / 连播 / 杜比视界色彩提示） */
const { notice, show: showNotice } = useTimedNotice()

/** 当前线路的播放队列（自动连播用） */
const playlist = ref<PlaylistEntry[]>([])
const position = ref(0)
/** 同集备用线路（失败自动换线路用） */
const fallbacks = ref<PlaylistEntry[]>([])
/** 当前使用的备用线路下标；-1 = 主线路 */
const activeFallback = ref(-1)
const defaultTitle = ref('正在播放')

/** 播完、等着连播：「下一集」倒计时卡片（可取消，见 SkipOverlay） */
const endedPrompt = ref(false)
/** 载荷带的「播完最后一集」提示，与正在显示的那一份 */
let queueEndHint: EndHint | null = null
const endHint = ref<EndHint | null>(null)

/** 播放失败且已无备用线路时展示的可操作错误信息 */
const failure = ref('')
const failedSource = ref('')
const retrying = ref(false)

/** 「继续播放」记录 id（载荷带了才记） */
const continueId = ref('')

const progress = useSessionProgress({
  progressKey,
  continueId,
  playlist,
  position,
  current: () => currentEntry.value,
  label: entry => entryLabel(entry),
})
/** 杜比视界 P5：主进程重建；做不了时按设置回退 mpv 或直接播 */
const dolbyVision = useDolbyVision({ src, emptyText, notify: showNotice })
/** 加载世代：丢弃过期的异步解析结果 */
let loadToken = 0
const art = shallowRef<Artplayer | null>(null)
const player = ref<InstanceType<typeof UnifiedVideoPlayer> | null>(null)

const currentEntry = computed<PlaylistEntry | null>(() => {
  if (activeFallback.value >= 0)
    return fallbacks.value[activeFallback.value] || null
  return playlist.value[position.value] || null
})

/** 内置解不了的文件交给 mpv */
const mpvHandoff = useMpvHandoff({
  entry: () => currentEntry.value,
  src: () => src.value,
  label: entry => entryLabel(entry),
  position: () => art.value?.currentTime || progress.startAt(),
  flush: () => progress.saver.flush(),
})
const { canHandOff, handingOff } = mpvHandoff

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

/** 恢复播放后清掉错误面板 */
const clearFailure = (): void => {
  failure.value = ''
  failedSource.value = ''
  mpvHandoff.reset()
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
  dolbyVision.release()
  progress.release()
  clearFailure()
  endedPrompt.value = false
  endHint.value = null

  if (!entry) {
    src.value = ''
    emptyText.value = '播放列表已结束'
    return
  }

  let resolved = ''
  if (entry.filePath) {
    progressKey.value = mediaProgressKey({ filePath: entry.filePath })
    resolved = await dolbyVision.resolve({
      filePath: entry.filePath,
      title: entryLabel(entry),
      startAt: progress.startAt(seededStartAt),
      known: entry.video,
      isCurrent: () => token === loadToken,
    })
    if (token !== loadToken || !resolved) return
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

  startAt.value = progress.startAt(seededStartAt)
  src.value = resolved
  progress.bind()
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

const onEnded = (event: Event): void => {
  if (playNext.pending()) return // 切集中：旧视频自然结束不再记完播、不再切集
  if (!media.accepts(event)) return // 托盘 / 媒体键换集时退役的旧视频
  const el = event.target as HTMLVideoElement | null
  progress.saver.markFinished(el)
  // 睡眠定时（看完本集 / 已到点）在连播前同步消费：停在本集
  if (consumeSleepAtEnd()) {
    showNotice('睡眠定时到了，已停止连播')
    return
  }
  const next = playlist.value[position.value + 1]
  if (!next) {
    emptyText.value = '已播放完最后一集'
    endHint.value = queueEndHint
    return
  }
  // 先给「下一集」卡片（可取消；自动连播关着时不倒计时）
  endedPrompt.value = true
}

/** 开播：清掉错误面板；播完卡片出现后又手动播放（拖回去重看）时收起卡片 */
const onPlay = (): void => {
  clearFailure()
  endedPrompt.value = false
  endHint.value = null
}

/** 卡顿 / 出错自动换到同集的下一条备用源，从当前进度继续 */
const switcher = useSourceSwitch({
  fallbacks,
  activeFallback,
  current: () => currentEntry.value,
  notify: showNotice,
  load: at => loadEntry(undefined, at),
})

const onVideo = (video: HTMLVideoElement): void => {
  switcher.attach(video)
  emit('video', video)
}

/** 播放失败（含 hls 致命错误）：自动切换到同集的下一条备用源 */
const onError = async (event?: Event): Promise<void> => {
  if (!media.accepts(event)) return
  // 杜比视界重建会话出错：退到 mpv，或重新加载同一文件、直接播
  const at = art.value?.currentTime || progress.startAt()
  const dv = await dolbyVision.recover(at)
  if (dv === 'reload') return loadEntry(undefined, at)
  if (dv) return
  if (await switcher.switchSource('error')) return
  // 备用线路也失败：给出可操作的错误界面；播放器给了原因（如网页端解不了 HEVC）就直接说
  const reason = event instanceof CustomEvent ? String(event.detail ?? '') : ''
  failure.value = fallbacks.value.length
    ? '当前线路与备用线路均无法播放。'
    : reason && reason !== '播放出错'
      ? reason
      : '无法播放该地址（可能是资源已失效或格式不受支持）。'
  failedSource.value = entryLabel(currentEntry.value)
  // 内置解不了（HEVC / AC3 / EAC3 / DTS 等）：桌面端直接交给 mpv；接力失败才留在错误面板
  await mpvHandoff.onFailure(reason)
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
  queueEndHint = queue.endHint
  // 起始项地址已由调用方解析过，直接复用以避免二次解析（url 始终对应 index 指向的那一集）
  void loadEntry(queue.seededUrl, queue.startAt)
}

watch(() => props.payload, applyPayload, { immediate: true })

/** 切换置顶，在画面上提示一句（全屏时也看得到） */
const togglePin = (): void => {
  const on = props.togglePin?.()
  if (art.value && on !== undefined)
    art.value.notice.show = on ? '已置顶' : '已取消置顶'
}

useSessionShortcuts({
  art,
  next: () =>
    playlist.value[position.value + 1] ? () => void playNext() : null,
  pin: () => (props.togglePin ? togglePin : null),
  toggleSubtitle: () => player.value?.toggleSubtitle(),
})

usePlayerRemote(art, () => ({
  skipKey: () => skipKey(continueId.value, defaultTitle.value),
  title: () => entryLabel(currentEntry.value),
  private: props.payload.private === true,
}))

onMounted(() => window.addEventListener('beforeunload', progress.saver.flush))

onBeforeUnmount(() => {
  progress.saver.flush()
  switcher.detach()
  window.removeEventListener('beforeunload', progress.saver.flush)
})
</script>

<style scoped src="./player-session.css"></style>
