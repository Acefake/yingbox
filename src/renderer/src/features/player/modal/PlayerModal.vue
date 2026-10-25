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
        <section class="player-modal__card">
          <!-- 播放会话所在的节点挂在这里；缩小时整体搬进小窗 -->
          <div ref="stageHost" class="player-modal__stage" />
          <!-- 顶栏：关闭圆钮 + 标题胶囊；中间留空可拖动窗口，右侧窗口键胶囊（桌面端） -->
          <header
            class="player-modal__bar"
            :class="{
              'is-visible': !idle || paused,
              'is-electron': isElectron,
            }"
          >
            <UiIconButton
              class="player-modal__close"
              icon="close"
              label="关闭播放器"
              variant="overlay"
              size="lg"
              @click="closePlayerModal"
            />
            <span class="player-modal__title yb-glass is-media">{{
              title
            }}</span>
            <WinControls
              v-if="isElectron"
              class="player-modal__window yb-glass is-media"
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
 * 铺满窗口；顶栏是压在画面上的玻璃控件（关闭圆钮、标题胶囊、窗口键胶囊），指针不动 3 秒后隐去，暂停时常显。
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
/* 全窗口的深色播放层，控件都是压在画面上的玻璃（.yb-glass is-media） */
.player-modal {
  outline: none;
  position: fixed;
  inset: 0;
  z-index: var(--z-player);
  background: var(--media-bg);
}

.player-modal__card {
  /* 顶部标题条的高度：玻璃胶囊 + 上下留白；播放信息浮层据此避开（playback-info.css） */
  --player-modal-bar-height: calc(
    var(--shell-pill-height) + 2 * var(--space-5)
  );
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--media-bg);
  color: var(--media-text);
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
  gap: var(--space-3);
  height: var(--player-modal-bar-height);
  padding: 0 var(--space-5);
  opacity: 0;
  transition: opacity var(--duration-normal) ease;
  pointer-events: none;
}

/* 桌面端：顶栏空白处可拖动窗口，控件本身不可拖 */
.player-modal__bar.is-electron {
  -webkit-app-region: drag;
}

.player-modal__bar.is-visible,
.player-modal__bar:focus-within {
  opacity: 1;
}

.player-modal__bar > * {
  pointer-events: auto;
  -webkit-app-region: no-drag;
}

.player-modal__close.yb-icon-button {
  --ib-size: var(--shell-pill-height);
}

.player-modal__title {
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

.player-modal__window {
  display: flex;
  align-items: center;
  gap: var(--space-0_5);
  height: var(--shell-pill-height);
  margin-left: auto;
  padding: 0 var(--space-1_5);
  border-radius: var(--radius-full);
}

.player-modal__window :deep(.yb-icon-button) {
  --ib-size: 36px;
  border-radius: var(--radius-full);
  color: var(--media-text);
}

.player-modal__window :deep(.yb-icon-button:hover:not(:disabled)) {
  background: var(--media-hover);
  color: var(--media-text);
}

/* 手机宽度：顶栏贴边更紧 */
@media (max-width: 768px) {
  .player-modal__bar {
    gap: var(--space-2);
    padding: var(--safe-top, 0) var(--space-3) 0;
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
