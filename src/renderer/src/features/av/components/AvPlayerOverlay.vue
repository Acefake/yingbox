<template>
  <Transition name="sheet-fade">
    <div v-if="show" class="av-player-backdrop" @click.self="emit('close')">
      <div class="av-player-page">
        <p v-if="message" class="av-player-message">{{ message }}</p>
        <UnifiedVideoPlayer
          :src="src"
          :poster="poster"
          :title="title"
          closable
          @ready="emit('ready', $event)"
          @loadedmetadata="emit('loadedmetadata')"
          @timeupdate="emit('timeupdate')"
          @volumechange="emit('volumechange')"
          @error="emit('error')"
          @ended="emit('ended')"
          @keydown="emit('keydown', $event)"
          @close="emit('close')"
        />
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * AV 页内播放层（非 Electron 兜底）：只保留视频画面、原生控制条和一行提示。
 * Electron 下播放一律走独立播放窗，这一层不会出现。
 */
import { UnifiedVideoPlayer } from '@/features/player'

defineProps<{
  show: boolean
  message: string
  src: string
  poster: string
  title: string
}>()
const emit = defineEmits<{
  (e: 'ready', video: HTMLVideoElement): void
  (e: 'keydown', event: KeyboardEvent): void
  (
    e:
      | 'loadedmetadata'
      | 'timeupdate'
      | 'volumechange'
      | 'error'
      | 'ended'
      | 'close'
  ): void
}>()
</script>

<style scoped>
.av-player-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-scrim);
}
.av-player-page {
  position: relative;
  display: flex;
  width: 92vw;
  max-width: 1200px;
  height: 78vh;
  max-height: 92vh;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--media-bg);
}
.av-player-message {
  position: absolute;
  top: var(--space-4);
  left: 50%;
  z-index: 10;
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--overlay-scrim);
  color: var(--media-text-secondary);
  font-size: var(--text-xs);
  transform: translateX(-50%);
}
</style>
