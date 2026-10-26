<template>
  <section class="player-stage">
    <PlayerSession
      v-if="session"
      :key="session.id"
      class="player-stage__session"
      :payload="session.payload"
      :toggle-pin="togglePin"
      @title="onTitle"
      @video="onVideo"
    />
    <p v-else class="player-stage__empty">等待播放…</p>
    <!-- 顶栏：关闭圆钮（网页端）+ 标题胶囊；中间留空可拖动窗口，右侧窗口键胶囊（桌面端） -->
    <header
      class="player-stage__bar"
      :class="{ 'is-visible': !idle || paused, 'is-electron': isElectron }"
    >
      <UiIconButton
        v-if="!windowed"
        class="player-stage__close"
        icon="close"
        label="关闭播放器"
        variant="overlay"
        size="lg"
        @click="emit('close')"
      />
      <span class="player-stage__title yb-glass is-media">{{ title }}</span>
      <WinControls
        v-if="isElectron"
        class="player-stage__window yb-glass is-media"
      />
    </header>
  </section>
</template>

<script setup lang="ts">
/**
 * 播放台：一次播放会话铺满容器，上面压着玻璃顶栏（标题胶囊、窗口键胶囊；网页端多一个关闭圆钮），
 * 指针不动 3 秒后顶栏隐去，暂停时常显。桌面端的播放器窗口与网页端的播放层都用它。
 *
 * 会话按 session.id 重建（换片即重新开始）；会话卸载时保存进度、拆除 Artplayer / hls.js。
 * 桌面端顶栏空白处可拖动窗口；网页端没有窗口键。
 */
import { useIdle } from '@vueuse/core'
import { defineAsyncComponent, ref, shallowRef, watch } from 'vue'

import WinControls from '@/components/WinControls.vue'
import { UiIconButton } from '@/components/ui'

import type { PlayerPayload } from '../utils/play-queue'

/** 播放会话连带 Artplayer / hls.js，第一次播放时才加载 */
const PlayerSession = defineAsyncComponent(
  () => import('../components/PlayerSession.vue')
)

const props = defineProps<{
  /** 当前会话；null 时显示「等待播放」 */
  session: { id: number; payload: PlayerPayload } | null
  /** 在独立播放器窗口里（窗口键胶囊带关闭，不另给关闭圆钮） */
  windowed?: boolean
  /** 切换窗口置顶，返回切换后的状态；不给就没有置顶按钮 */
  togglePin?: (() => boolean) | null
}>()
const emit = defineEmits<{
  /** 网页端的关闭圆钮 */
  close: []
  /** 当前条目名（换集时变） */
  title: [title: string]
}>()

/** 指针多久不动后隐藏顶栏（与控制栏的自动隐藏一致，暂停时常显） */
const IDLE_MS = 3000

const isElectron = Boolean(window.api?.win)
const title = ref('')
const video = shallowRef<HTMLVideoElement | null>(null)
/** 当前视频暂停中：顶栏常显 */
const paused = ref(true)

const { idle } = useIdle(IDLE_MS, {
  events: ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'],
})

const onTitle = (next: string): void => {
  title.value = next
  emit('title', next)
}

const syncPaused = (event: Event): void => {
  paused.value = (event.target as HTMLVideoElement).paused
}

const onVideo = (el: HTMLVideoElement): void => {
  video.value?.removeEventListener('play', syncPaused)
  video.value?.removeEventListener('pause', syncPaused)
  video.value = el
  paused.value = el.paused
  el.addEventListener('play', syncPaused)
  el.addEventListener('pause', syncPaused)
}

// 换了会话：标题先用载荷里的，等会话报上当前条目名
watch(
  () => props.session?.id,
  () => {
    video.value = null
    onTitle(props.session?.payload.title?.trim() || '正在播放')
  },
  { immediate: true }
)
</script>

<style scoped>
/* 深色播放台，控件都是压在画面上的玻璃（.yb-glass is-media） */
.player-stage {
  /* 顶栏的高度：玻璃胶囊 + 上下留白；播放信息浮层据此避开（playback-info.css） */
  --player-stage-bar-height: calc(
    var(--shell-pill-height) + 2 * var(--space-5)
  );
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--media-bg);
  color: var(--media-text);
}

.player-stage__session {
  position: absolute;
  inset: 0;
}

.player-stage__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  color: var(--media-text-tertiary);
  font-size: var(--text-md);
}

.player-stage__bar {
  position: absolute;
  inset: 0 0 auto;
  z-index: var(--z-overlay);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--player-stage-bar-height);
  padding: 0 var(--space-5);
  opacity: 0;
  transition: opacity var(--duration-normal) ease;
  pointer-events: none;
}

/* 桌面端：顶栏空白处可拖动窗口，控件本身不可拖 */
.player-stage__bar.is-electron {
  -webkit-app-region: drag;
}

.player-stage__bar.is-visible,
.player-stage__bar:focus-within {
  opacity: 1;
}

.player-stage__bar > * {
  pointer-events: auto;
  -webkit-app-region: no-drag;
}

.player-stage__close.yb-icon-button {
  --ib-size: var(--shell-pill-height);
}

.player-stage__title {
  flex: 0 1 auto;
  min-width: 0;
  max-width: min(560px, 50%);
  height: var(--shell-pill-height);
  padding: 0 var(--space-5);
  overflow: hidden;
  border-radius: var(--radius-full);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  line-height: var(--shell-pill-height);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-stage__window {
  display: flex;
  align-items: center;
  gap: var(--space-0_5);
  height: var(--shell-pill-height);
  margin-left: auto;
  padding: 0 var(--space-1_5);
  border-radius: var(--radius-full);
}

.player-stage__window :deep(.yb-icon-button) {
  --ib-size: 36px;
  border-radius: var(--radius-full);
  color: var(--media-text);
}

.player-stage__window :deep(.yb-icon-button:hover:not(:disabled)) {
  background: var(--media-hover);
  color: var(--media-text);
}

/* 手机宽度：顶栏贴边更紧 */
@media (max-width: 768px) {
  .player-stage__bar {
    gap: var(--space-2);
    padding: var(--safe-top, 0) var(--space-3) 0;
  }
}
</style>
