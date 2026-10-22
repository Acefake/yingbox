<template>
  <Teleport to="body">
    <div
      v-if="payload"
      class="inline-player"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <PlayerSession :payload="payload" @title="title = $event" />
      <!-- 顶栏：返回、片名、窗口按钮；整条可拖动窗口，指针不动就淡出 -->
      <header class="inline-player-bar" :class="{ 'is-visible': barVisible }">
        <UiIconButton
          icon="back"
          label="返回"
          variant="overlay"
          @click="closeInlinePlayer"
        />
        <span class="inline-player-title">{{ title }}</span>
        <WinControls v-if="isElectron" class="inline-player-win" />
      </header>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 应用内播放器：盖住整个主窗口播放（不再开独立窗口），关闭回到原来的页面，页面状态不变。
 * 播放逻辑在 PlayerSession；这里只管图层、顶栏与 Esc 关闭。应用根组件挂载一次。
 */
import { useIdle } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import WinControls from '@/components/WinControls.vue'
import { UiIconButton } from '@/components/ui'
import { useEscapeLayer } from '@/composables/use-escape-layer'

import PlayerSession from '../components/PlayerSession.vue'
import { closeInlinePlayer, inlinePlayback } from './inline-player'

/** 指针多久不动后隐藏顶栏 */
const IDLE_MS = 2500

const payload = inlinePlayback()
const title = ref('')
const isElectron = Boolean(window.api?.win)

const { idle } = useIdle(IDLE_MS, {
  events: ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'],
})
const barVisible = computed(() => !idle.value)

// 换片时先用载荷里的标题顶上，会话解析出条目名后再替换
watch(payload, next => (title.value = next?.title?.trim() || '正在播放'))

// 全屏时 Esc 由浏览器先退出全屏，不会走到这里
useEscapeLayer(() => payload.value !== null, closeInlinePlayer)
</script>

<style scoped>
.inline-player {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--media-bg);
  color: var(--media-text);
}

.inline-player-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-overlay);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--titlebar-height);
  padding: 0 var(--space-3);
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--media-bg) 60%, transparent),
    transparent
  );
  opacity: 0;
  transition: opacity var(--duration-normal) ease;
  -webkit-app-region: drag;
  user-select: none;
}
.inline-player-bar.is-visible,
.inline-player-bar:focus-within {
  opacity: 1;
}
.inline-player-bar > :deep(button),
.inline-player-win {
  -webkit-app-region: no-drag;
}

.inline-player-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
