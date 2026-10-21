<template>
  <Teleport to="body">
    <div
      v-if="playback"
      class="web-player"
      role="dialog"
      aria-modal="true"
      :aria-label="playback.title"
      @keydown.esc="closeWebPlayer"
    >
      <header class="web-player__bar">
        <span class="web-player__title">
          {{ playback.title }}
          <template v-if="playback.sources.length > 1">
            · {{ current?.name }}
          </template>
        </span>
        <UiIconButton
          v-if="playback.sources.length > 1"
          icon="skipBack"
          label="上一个"
          variant="overlay"
          :disabled="playback.index === 0"
          @click="seekWebPlayer(playback.index - 1)"
        />
        <UiIconButton
          v-if="playback.sources.length > 1"
          icon="skipForward"
          label="下一个"
          variant="overlay"
          :disabled="playback.index >= playback.sources.length - 1"
          @click="seekWebPlayer(playback.index + 1)"
        />
        <UiIconButton
          icon="close"
          label="关闭"
          variant="overlay"
          @click="closeWebPlayer"
        />
      </header>
      <video
        :key="current?.url"
        ref="video"
        class="web-player__video"
        :src="current?.url"
        :poster="playback.poster"
        controls
        autoplay
        playsinline
        @ended="seekWebPlayer(playback.index + 1)"
        @error="failed = true"
      />
      <p v-if="failed" class="web-player__error" role="alert">
        浏览器无法播放这个文件（常见于 MKV / HEVC），请用桌面端的内置播放器或
        mpv。
      </p>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 网页端页内播放器：原生 <video> + 片库服务的 Range 流，按顺序连播（分段电影 / 一季的集）。
 * 桌面端不会出现（那里走内置播放器窗口或 mpv）。Esc 或关闭按钮退出。
 */
import { computed, nextTick, ref, watch } from 'vue'

import { UiIconButton } from '@/components/ui'
import { closeWebPlayer, seekWebPlayer, webPlayback } from './web-player'

const playback = webPlayback()
const current = computed(() =>
  playback.value ? playback.value.sources[playback.value.index] : null
)
const video = ref<HTMLVideoElement | null>(null)
const failed = ref(false)

watch(current, async value => {
  failed.value = false
  if (!value) return
  await nextTick()
  video.value?.focus()
})
</script>

<style scoped>
.web-player {
  position: fixed;
  inset: 0;
  z-index: var(--z-player-overlay);
  display: flex;
  flex-direction: column;
  background: #000; /* style-tokens: layout（视频底色恒为纯黑） */
}
.web-player__bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  color: #fff; /* style-tokens: layout（叠在黑底上） */
}
.web-player__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.web-player__video {
  flex: 1;
  width: 100%;
  min-height: 0;
  outline: none;
}
.web-player__error {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  text-align: center;
}
</style>
