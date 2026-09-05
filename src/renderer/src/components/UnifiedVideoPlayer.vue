<template>
  <div class="unified-player" @click.stop>
    <div class="unified-player-video-area">
      <video
        ref="video"
        class="unified-player-video"
        :poster="poster"
        :controls="controls"
        :autoplay="autoplay"
        playsinline
        preload="auto"
        tabindex="0"
        @loadedmetadata="$emit('loadedmetadata', $event)"
        @timeupdate="$emit('timeupdate', $event)"
        @volumechange="$emit('volumechange', $event)"
        @error="$emit('error', $event)"
        @ended="$emit('ended', $event)"
        @play="$emit('play', $event)"
        @pause="$emit('pause', $event)"
        @keydown="$emit('keydown', $event)"
      />
    </div>
    <div v-if="closable || title" class="unified-player-footer">
      <span class="unified-player-title">{{ title || '正在播放' }}</span>
      <button v-if="closable" type="button" class="unified-player-close" aria-label="关闭播放器" @click="$emit('close')">×</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Hls from 'hls.js'

const props = withDefaults(defineProps<{
  src?: string
  poster?: string
  title?: string
  closable?: boolean
  autoplay?: boolean
  controls?: boolean
  resolveUrl?: (url: string) => Promise<string>
}>(), {
  src: '',
  poster: '',
  title: '',
  closable: true,
  autoplay: true,
  controls: true,
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

const video = ref<HTMLVideoElement | null>(null)
let hls: Hls | null = null
let loadToken = 0

const destroyHls = () => {
  if (!hls) return
  hls.destroy()
  hls = null
}

const attachSource = async (source: string) => {
  const el = video.value
  const token = ++loadToken
  destroyHls()
  if (!el) return

  el.pause()
  el.removeAttribute('src')
  el.load()
  if (!source) return

  let resolved: string
  try {
    resolved = props.resolveUrl ? await props.resolveUrl(source) : source
    if (!resolved) throw new Error('未获取到播放地址')
  } catch {
    if (token === loadToken) emit('error', new Event('error'))
    return
  }
  if (token !== loadToken || !video.value) return

  if (Hls.isSupported() && /\.m3u8(?:$|\?)/i.test(resolved)) {
    hls = new Hls({ enableWorker: true })
    hls.loadSource(resolved)
    hls.attachMedia(el)
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (props.autoplay) el.play().catch(() => {})
    })
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) emit('error', new Event('error'))
    })
  } else {
    el.src = resolved
    if (props.autoplay) el.play().catch(() => {})
  }
}

watch(() => props.src, source => { void attachSource(source) }, { immediate: true })

onMounted(async () => {
  await nextTick()
  if (video.value) {
    emit('ready', video.value)
    if (props.src) void attachSource(props.src)
  }
})

onBeforeUnmount(() => {
  loadToken++
  destroyHls()
  if (video.value) {
    video.value.pause()
    video.value.removeAttribute('src')
    video.value.load()
  }
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

.unified-player-video-area {
  position: relative;
  min-height: 0;
  flex: 1;
}

.unified-player-video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
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
  color: rgba(255, 255, 255, 0.88);
  background: #161b22;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.unified-player-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
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
  color: rgba(255, 255, 255, 0.62);
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}

.unified-player-close:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
}
</style>
