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
    />
    <div v-else class="player-popout-empty">
      <img v-if="poster" class="player-popout-poster" :src="poster" alt="" />
      <span>等待加载视频…</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import UnifiedVideoPlayer from '@/components/UnifiedVideoPlayer.vue'
import { toLocalUrl } from '@/utils/local-url'
import { mediaProgressKey, saveMediaProgress } from '@/utils/play-progress'

type PlayerPayload = {
  filePath?: string
  url?: string
  title?: string
  poster?: string
  startAt?: number
}

const route = useRoute()
const src = ref('')
const poster = ref('')
const startAt = ref(0)
const progressKey = ref('')

let lastPersist = 0
let lastTime = 0
let lastDuration = 0

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

const onEnded = (event: Event): void => {
  const el = event.target as HTMLVideoElement | null
  if (el && progressKey.value) {
    // Near end: reset so next resume starts from beginning
    saveMediaProgress(progressKey.value, 0, Number.isFinite(el.duration) ? el.duration : 0)
    lastTime = 0
  }
}

const applyPayload = (payload: PlayerPayload): void => {
  const filePath = typeof payload.filePath === 'string' ? payload.filePath.trim() : ''
  const url = typeof payload.url === 'string' ? payload.url.trim() : ''
  const maybeTitle = typeof payload.title === 'string' ? payload.title.trim() : ''
  const maybePoster = typeof payload.poster === 'string' ? payload.poster.trim() : ''
  const maybeStart =
    typeof payload.startAt === 'number' && Number.isFinite(payload.startAt)
      ? Math.max(0, payload.startAt)
      : 0

  if (url) {
    src.value = url
  } else if (filePath) {
    src.value = toLocalUrl(filePath)
  } else {
    return
  }

  poster.value = maybePoster
  startAt.value = maybeStart
  progressKey.value = mediaProgressKey({ url, filePath })

  const label = maybeTitle || (filePath ? filePath.split(/[/\\]/).pop() : '') || '正在播放'
  document.title = `影盒 - ${label}`
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
    if (pending?.url || pending?.filePath) applyPayload(pending)
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