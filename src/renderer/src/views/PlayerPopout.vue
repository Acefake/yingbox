<template>
  <div class="player-popout">
    <UnifiedVideoPlayer
      v-if="src"
      :src="src"
      :poster="poster"
      :start-at="startAt"
      title=""
      :closable="false"
      :show-footer="false"
      autoplay
      controls
      @timeupdate="onTimeUpdate"
      @pause="flushProgress"
      @ended="onEnded"
      @error="onError"
    />
    <div v-else class="player-popout-empty">
      <img v-if="poster" class="player-popout-poster" :src="poster" alt="" />
      <span>{{ emptyText }}</span>
    </div>
    <p v-if="notice" class="player-popout-notice">{{ notice }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import UnifiedVideoPlayer from '@/components/UnifiedVideoPlayer.vue'
import { toLocalUrl } from '@/utils/local-url'
import { getMediaProgress, mediaProgressKey, saveMediaProgress } from '@/utils/play-progress'
import { resolvePlaySource } from '@/utils/play-source'

/** 单个播放条目（集 / 文件 / 备用线路） */
type Entry = {
  url?: string
  filePath?: string
  name?: string
  ext?: Record<string, unknown>
  siteName?: string
}

type PlayerPayload = {
  filePath?: string
  url?: string
  title?: string
  poster?: string
  startAt?: number
  playlist?: Entry[]
  index?: number
  fallbacks?: Entry[]
}

const route = useRoute()
const src = ref('')
const poster = ref('')
const startAt = ref(0)
const progressKey = ref('')
const emptyText = ref('等待加载视频…')
/** 短暂提示（自动换线路 / 连播时可见） */
const notice = ref('')

/** 当前线路的播放队列（自动连播用） */
const playlist = ref<Entry[]>([])
const position = ref(0)
/** 同集备用线路（失败自动换线路用） */
const fallbacks = ref<Entry[]>([])
/** 当前使用的备用线路下标；-1 = 主线路 */
const activeFallback = ref(-1)

const defaultTitle = ref('正在播放')

let lastPersist = 0
let lastTime = 0
let lastDuration = 0
/** 加载世代：丢弃过期的异步解析结果 */
let loadToken = 0
let noticeTimer: number | undefined

const currentEntry = computed<Entry | null>(() => {
  if (activeFallback.value >= 0) return fallbacks.value[activeFallback.value] || null
  return playlist.value[position.value] || null
})

const showNotice = (text: string): void => {
  notice.value = text
  if (noticeTimer) window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 4000)
}

const entryLabel = (entry: Entry | null | undefined): string => {
  const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
  if (name) return name
  if (entry?.filePath) return entry.filePath.split(/[/\\]/).pop() || defaultTitle.value
  return defaultTitle.value
}

const flushProgress = (): void => {
  if (!progressKey.value) return
  if (!(lastTime > 1)) return
  saveMediaProgress(progressKey.value, lastTime, lastDuration)
}

const onTimeUpdate = (event: Event): void => {
  const el = event.target as HTMLVideoElement | null
  if (!el || !progressKey.value) return
  lastTime = el.currentTime || 0
  lastDuration = Number.isFinite(el.duration) ? el.duration : 0
  const now = Date.now()
  if (now - lastPersist < 2000) return
  lastPersist = now
  saveMediaProgress(progressKey.value, lastTime, lastDuration)
}

/**
 * 加载当前条目。
 *
 * @param seeded 调用方已解析好的地址（起始集复用，避免二次解析）
 * @param seededStartAt 起始续播位置
 */
const loadEntry = async (seeded?: string, seededStartAt?: number): Promise<void> => {
  const token = ++loadToken
  const entry = currentEntry.value
  lastTime = 0
  lastDuration = 0

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
    return
  }

  if (!resolved) {
    src.value = ''
    emptyText.value = '无法解析播放地址'
    return
  }

  const stored = getMediaProgress(progressKey.value)
  startAt.value =
    typeof seededStartAt === 'number' && seededStartAt > 0 ? seededStartAt : stored
  src.value = resolved
  document.title = `影盒 - ${entryLabel(entry)}`
}

/** 自动连播：切到当前线路的下一集 */
const playNext = async (): Promise<boolean> => {
  if (position.value + 1 >= playlist.value.length) return false
  activeFallback.value = -1
  position.value += 1
  await loadEntry()
  return true
}

const onEnded = async (event: Event): Promise<void> => {
  const el = event.target as HTMLVideoElement | null
  const duration = el && Number.isFinite(el.duration) ? el.duration : lastDuration
  if (progressKey.value) {
    // 已看完：清除续播点，下次从头播放
    saveMediaProgress(progressKey.value, 0, duration)
  }
  lastTime = 0
  const next = playlist.value[position.value + 1]
  if (next) {
    showNotice(`即将播放：${entryLabel(next)}`)
    await playNext()
    return
  }
  emptyText.value = '已播放完最后一集'
}

/** 播放失败：自动切换到同集的下一条备用线路 */
const onError = async (): Promise<void> => {
  const nextFallback = activeFallback.value + 1
  if (nextFallback < fallbacks.value.length) {
    activeFallback.value = nextFallback
    showNotice(`播放失败，切换线路：${entryLabel(fallbacks.value[nextFallback])}`)
    await loadEntry()
    return
  }
  showNotice('播放失败，未找到可用备用线路')
}

const applyPayload = (payload: PlayerPayload): void => {
  const filePath = typeof payload.filePath === 'string' ? payload.filePath.trim() : ''
  const url = typeof payload.url === 'string' ? payload.url.trim() : ''
  const maybeTitle = typeof payload.title === 'string' ? payload.title.trim() : ''
  const maybePoster = typeof payload.poster === 'string' ? payload.poster.trim() : ''
  const maybeStart =
    typeof payload.startAt === 'number' && Number.isFinite(payload.startAt)
      ? Math.max(0, payload.startAt)
      : undefined

  defaultTitle.value = maybeTitle || '正在播放'

  const incoming = Array.isArray(payload.playlist) ? payload.playlist.filter(Boolean) : []
  if (incoming.length) {
    playlist.value = incoming
    const rawIndex = Number(payload.index)
    position.value =
      Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < incoming.length ? rawIndex : 0
  } else if (url || filePath) {
    // 单条目：等价于长度为 1 的队列，仍记录进度，但不触发连播
    playlist.value = [{ ...(url ? { url } : {}), ...(filePath ? { filePath } : {}) }]
    position.value = 0
  } else {
    return
  }

  fallbacks.value = Array.isArray(payload.fallbacks) ? payload.fallbacks.filter(Boolean) : []
  activeFallback.value = -1
  poster.value = maybePoster

  // 起始项地址已由调用方解析过，直接复用以避免二次解析（url 始终对应 index 指向的那一集）
  void loadEntry(url || undefined, maybeStart)
}

onMounted(() => {
  const qPath = typeof route.query.filePath === 'string' ? route.query.filePath : ''
  const qUrl = typeof route.query.url === 'string' ? route.query.url : ''
  const qTitle = typeof route.query.title === 'string' ? route.query.title : undefined
  const qStartRaw = typeof route.query.startAt === 'string' ? Number(route.query.startAt) : 0
  if (qUrl || qPath) {
    applyPayload({
      filePath: qPath,
      url: qUrl,
      title: qTitle,
      startAt: Number.isFinite(qStartRaw) ? qStartRaw : 0,
    })
  }

  window.api?.player?.onLoad?.((payload) => {
    applyPayload(payload)
  })

  void window.api?.player?.getPending?.().then((pending) => {
    if (pending?.url || pending?.filePath || pending?.playlist?.length) {
      applyPayload(pending)
    }
  })

  window.addEventListener('beforeunload', flushProgress)
})

onBeforeUnmount(() => {
  flushProgress()
  window.removeEventListener('beforeunload', flushProgress)
  window.api?.player?.offLoad?.()
})
</script>

<style scoped>
.player-popout {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  background: #000;
  color: #fff;
  overflow: hidden;
}

.player-popout :deep(.unified-player) {
  width: 100%;
  height: 100%;
}

.player-popout-empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  opacity: 0.85;
  font-size: 14px;
}

.player-popout-poster {
  max-width: min(72%, 420px);
  max-height: min(60vh, 520px);
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}
</style>