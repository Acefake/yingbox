<template>
  <Teleport to="body">
    <Transition name="player-modal">
      <div
        v-show="visible"
        ref="modalRef"
        class="player-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
        @keydown="trapTab"
      >
        <!-- 遮罩盖住了标题栏：顶部留一条可拖动窗口的区域和窗口按钮 -->
        <div v-if="isElectron" class="player-modal__titlebar">
          <WinControls />
        </div>
        <section class="player-modal__card">
          <!-- 播放会话所在的节点挂在这里；缩小时整体搬进小窗 -->
          <div ref="stageHost" class="player-modal__stage" />
          <header
            class="player-modal__bar"
            :class="{ 'is-visible': !idle || paused }"
          >
            <span class="player-modal__title">{{ title }}</span>
            <UiIconButton
              icon="close"
              label="关闭播放器"
              variant="overlay"
              @click="closePlayerModal"
            />
          </header>
        </section>
      </div>
    </Transition>
  </Teleport>
  <Teleport :to="shell">
    <PlayerSession
      v-if="state"
      :key="state.id"
      :payload="state.payload"
      :mini="state.minimized"
      @title="title = $event"
      @video="onVideo"
      @minimize="minimize"
    />
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 应用内播放弹窗：盖在当前页面上播放（页面状态不变），桌面与网页同一个组件，应用根组件挂载一次。
 *
 * - 关闭：Esc（输入法组字中的不算，走全局 Esc 层栈）或关闭按钮；点遮罩不关，免得误触丢掉播放。
 *   播放会话卸载时保存进度、拆除 Artplayer / hls.js。
 * - 缩小：控制栏「小窗」按钮或快捷键 I（播放会话发 minimize）；播放会话所在的节点（shell）整体搬进角落小窗，
 *   播放器不重建；小窗里「展开」再搬回来。
 *   切路由时自动缩成小窗，小窗跨路由保持；设置关掉小窗时没有缩小按钮，切路由时弹窗保持。
 * - 画中画用播放器控制条自带的按钮（浏览器支持时显示）。
 *
 * 播放会话用 Teleport 渲染进 shell：shell 不归模板管，可以在弹窗和小窗之间搬，Vue 不会往它旁边插节点。
 */
import { useIdle } from '@vueuse/core'
import {
  computed,
  defineAsyncComponent,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useRoute } from 'vue-router'

import WinControls from '@/components/WinControls.vue'
import { UiIconButton } from '@/components/ui'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { useModalFocus } from '@/composables/use-focus-trap'

import { claimMini, dockMini, swapMiniVideo } from '../mini/mini-dock'
import {
  closePlayerModal,
  playerModal,
  setPlayerModalMinimized,
} from './player-modal'

/** 播放会话连带 Artplayer / hls.js，第一次播放时才加载 */
const PlayerSession = defineAsyncComponent(
  () => import('../components/PlayerSession.vue')
)

/** 指针多久不动后隐藏顶栏（与控制栏的自动隐藏一致，暂停时常显） */
const IDLE_MS = 3000

const state = playerModal()
const title = ref('')
const video = shallowRef<HTMLVideoElement | null>(null)
/** 当前视频暂停中：顶栏常显 */
const paused = ref(true)
const stageHost = ref<HTMLElement | null>(null)
const isElectron = Boolean(window.api?.win)
const visible = computed(() => Boolean(state.value && !state.value.minimized))

const shell = document.createElement('div')
shell.className = 'player-modal-shell'
shell.style.cssText = 'position: absolute; inset: 0;'

const { idle } = useIdle(IDLE_MS, {
  events: ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'],
})

/** 把 shell 放回弹窗（打开新会话、展开、关闭后都要回到这里） */
const homeShell = (): void => {
  if (stageHost.value && shell.parentElement !== stageHost.value)
    stageHost.value.appendChild(shell)
}
onMounted(homeShell)

const keyOf = (id: number): string => `player-modal:${id}`

/** 展开：从小窗认领回来 */
const expand = (): void => {
  const current = state.value
  if (!current || !claimMini(keyOf(current.id))) return
  homeShell()
  setPlayerModalMinimized(false)
}

/** 缩成小窗；设置关闭、还没有画面时不缩 */
const minimize = (): void => {
  const current = state.value
  if (!current || current.minimized || !video.value) return
  const ok = dockMini({
    key: keyOf(current.id),
    title: title.value,
    node: shell,
    video: video.value,
    restore: expand,
    teardown: closePlayerModal,
  })
  if (ok) setPlayerModalMinimized(true)
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
  const current = state.value
  if (current?.minimized) swapMiniVideo(keyOf(current.id), el)
}

// 换了会话或关闭：上一个若还在小窗里，认领回来（不拆——旧会话随 key 变化卸载时自己拆除）
watch(
  () => state.value?.id,
  (id, prev) => {
    if (prev != null && prev !== id) claimMini(keyOf(prev))
    video.value = null
    title.value = state.value?.payload.title?.trim() || '正在播放'
    homeShell()
  },
  { flush: 'sync' }
)

const route = useRoute()
watch(
  () => route.path,
  () => minimize()
)

// 全屏时 Esc 由浏览器先退出全屏，不会走到这里
useEscapeLayer(() => visible.value, closePlayerModal)
// 模态：Tab 只在播放弹窗里循环；缩成小窗或关闭后焦点还给打开前的元素。
// Artplayer 控制条与齿轮菜单（画质 / 字幕 / 音轨）都渲染在 shell 里，属于弹窗内部；挂到 body 上的
// 只有不可聚焦的 tooltip、popover 提示与 <dialog> 确认框，侧栏助手带 data-focus-scope，陷阱都放行
const modalRef = ref<HTMLElement | null>(null)
const trapTab = useModalFocus(modalRef, () => visible.value)
</script>

<style scoped>
.player-modal {
  outline: none;
  position: fixed;
  inset: 0;
  z-index: var(--z-player);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: var(--overlay-scrim);
}

.player-modal__titlebar {
  position: absolute;
  inset: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: var(--titlebar-height);
  padding: 0 var(--space-3);
  -webkit-app-region: drag;
}

.player-modal__card {
  /* 顶部标题条的高度：关闭按钮 + 上下留白；播放信息浮层据此避开（playback-info.css） */
  --player-modal-bar-height: calc(var(--control-height) + 2 * var(--space-2));
  position: relative;
  width: min(1200px, 100%, calc((100vh - 2 * var(--titlebar-height)) * 16 / 9));
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--radius-xl);
  background: var(--media-bg);
  color: var(--media-text);
  box-shadow: var(--shadow-lg);
}

.player-modal__stage {
  position: absolute;
  inset: 0;
}

.player-modal__bar {
  position: absolute;
  inset: 0 0 auto;
  z-index: var(--z-overlay);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--player-modal-bar-height);
  padding: 0 var(--space-3);
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--media-bg) 60%, transparent),
    transparent
  );
  opacity: 0;
  transition: opacity var(--duration-normal) ease;
}

.player-modal__bar.is-visible,
.player-modal__bar:focus-within {
  opacity: 1;
}

.player-modal__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 手机宽度：铺满宽度，不留圆角 */
@media (max-width: 768px) {
  .player-modal {
    padding: 0;
  }
  .player-modal__card {
    width: 100%;
    border-radius: 0;
  }
}

.player-modal-enter-active,
.player-modal-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}

.player-modal-enter-from,
.player-modal-leave-to {
  opacity: 0;
}
</style>
