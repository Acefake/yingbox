<template>
  <!-- 无边框窗口的顶栏：拖动窗口、片名、缩小置顶；系统窗口按钮由 titleBarOverlay 画在右侧 -->
  <header class="player-title-bar" :class="{ 'is-visible': visible }">
    <span class="player-title-bar-text">{{ title }}</span>
    <CompactWindowButton class="player-title-bar-action" />
  </header>
</template>

<script setup lang="ts">
/**
 * 独立播放窗口的顶栏（窗口是无边框的，见 main/player-window.ts 的 framelessOptions）。
 *
 * - 占据 titlebar-area（Window Controls Overlay 的 env 变量），自动让开右侧系统按钮 / 左侧红绿灯
 * - 整条可拖动窗口，按钮区域除外
 * - 指针 2.5 秒不动就淡出，动一下或悬停在顶栏上时出现
 */
import { useIdle } from '@vueuse/core'
import { computed } from 'vue'

import CompactWindowButton from './CompactWindowButton.vue'

defineProps<{ title: string }>()

/** 指针不动多久后隐藏顶栏 */
const IDLE_MS = 2500

const { idle } = useIdle(IDLE_MS, {
  events: ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'],
})
const visible = computed(() => !idle.value)
</script>

<style scoped>
.player-title-bar {
  position: fixed;
  top: env(titlebar-area-y, 0);
  left: env(titlebar-area-x, 0);
  z-index: var(--z-overlay);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: env(titlebar-area-width, 100%);
  height: env(titlebar-area-height, 36px);
  padding: 0 var(--space-2) 0 var(--space-4);
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), transparent);
  color: var(--media-text);
  opacity: 0;
  transition: opacity var(--duration-normal) ease;
  -webkit-app-region: drag;
  user-select: none;
}
.player-title-bar.is-visible,
.player-title-bar:hover,
.player-title-bar:focus-within {
  opacity: 1;
}
.player-title-bar-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.player-title-bar-action {
  flex: 0 0 auto;
  -webkit-app-region: no-drag;
}
</style>
