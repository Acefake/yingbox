<template>
  <UiIconButton
    v-if="available"
    class="compact-window-button"
    icon="pin"
    :label="compact ? '还原窗口' : '缩小置顶'"
    :active="compact"
    variant="overlay"
    size="sm"
    @click="toggle"
  />
</template>

<script setup lang="ts">
/**
 * 独立播放窗口右上角的「缩小置顶」：整个窗口缩到屏幕右下角并保持在最前，再点还原。
 * 和画中画（播放器控制栏里）互补：画中画只有画面，这个保留字幕、控制条与自动连播。
 * 指针移到窗口上才显示。
 */
import { ref } from 'vue'

import UiIconButton from '@/components/ui/UiIconButton.vue'

const available = Boolean(window.api?.player?.setCompact)
const compact = ref(false)

const toggle = async (): Promise<void> => {
  const result = await window.api.player.setCompact(!compact.value)
  if (result.success) compact.value = result.compact
}
</script>

<style scoped>
.compact-window-button {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  z-index: var(--z-overlay);
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}

:global(.player-popout:hover) .compact-window-button,
.compact-window-button:focus-visible {
  opacity: 1;
}
</style>
