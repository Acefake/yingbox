<template>
  <div
    v-show="session"
    ref="frame"
    class="mini-player"
    :class="[`is-${corner}`, { 'is-settling': settling }]"
    :style="frameStyle"
    role="region"
    :aria-label="`小窗播放：${session?.title ?? ''}`"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @focusin="focused = true"
    @focusout="onFocusOut"
  >
    <!-- 播放器节点被原样搬进这里；挂载点常驻文档，搬移时 <video> 不会离开文档 -->
    <div ref="slotEl" class="mini-player__slot" data-mini-slot />
    <div v-if="session" class="mini-player__bar">
      <UiIconButton
        :icon="paused ? 'play' : 'pause'"
        :label="paused ? '播放' : '暂停'"
        variant="overlay"
        size="sm"
        @click="togglePlay"
      />
      <UiIconButton
        icon="maximize"
        label="展开"
        variant="overlay"
        size="sm"
        @click="returnFromMini"
      />
      <UiIconButton
        icon="close"
        label="关闭小窗"
        variant="overlay"
        size="sm"
        @click="closeMini"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 应用内小窗：右下角浮动，可拖动、松手吸附到最近的角；播放 / 暂停、展开回播放弹窗、关闭。
 * 只是外壳——播放会话由播放弹窗交来（mini-dock），这里不创建任何播放器。
 * 设置 ui.miniPlayer 关掉时立即拆除。吸附的过渡用 --duration-normal，减少动态效果时为 0。
 * Esc：只有焦点在小窗里时才是一层（接入全局 Esc 层栈），关掉小窗；焦点在别处时 Esc 不会误关后台播放。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import UiIconButton from '@/components/ui/UiIconButton.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { getSetting } from '@/features/settings'

import {
  closeMini,
  miniSession,
  returnFromMini,
  setMiniSlot,
} from './mini-dock'
import { type MiniCorner, nearestCorner } from './snap'

const session = miniSession()
const frame = ref<HTMLElement | null>(null)
const slotEl = ref<HTMLElement | null>(null)
const corner = ref<MiniCorner>('bottom-right')
const paused = ref(true)
/** 相对所停靠角的位移：拖动中跟手，松手后过渡回 0 */
const offset = ref({ x: 0, y: 0 })
const settling = ref(false)
const focused = ref(false)

const onFocusOut = (event: FocusEvent): void => {
  if (!frame.value?.contains(event.relatedTarget as Node | null))
    focused.value = false
}
useEscapeLayer(() => Boolean(session.value) && focused.value, closeMini)

/** 拖动中的起点（指针坐标 − 当时的位移）；没在拖为 null */
let dragStart: { x: number; y: number; id: number } | null = null

const frameStyle = computed(() =>
  offset.value.x || offset.value.y
    ? { transform: `translate(${offset.value.x}px, ${offset.value.y}px)` }
    : undefined
)

// 播放 / 暂停按钮跟着 <video> 的真实状态走
let unbind: (() => void) | null = null
watch(
  session,
  current => {
    unbind?.()
    unbind = null
    if (!current) return
    const video = current.video
    const sync = (): void => {
      paused.value = video.paused
    }
    sync()
    video.addEventListener('play', sync)
    video.addEventListener('pause', sync)
    unbind = () => {
      video.removeEventListener('play', sync)
      video.removeEventListener('pause', sync)
    }
  },
  { immediate: true }
)

watch(
  () => getSetting('ui.miniPlayer'),
  enabled => {
    if (!enabled) closeMini()
  }
)

const togglePlay = (): void => {
  const video = session.value?.video
  if (!video) return
  if (video.paused) void video.play()?.catch(() => {})
  else video.pause()
}

const onPointerDown = (event: PointerEvent): void => {
  if ((event.target as Element | null)?.closest('button')) return
  settling.value = false
  dragStart = {
    x: event.clientX - offset.value.x,
    y: event.clientY - offset.value.y,
    id: event.pointerId,
  }
  frame.value?.setPointerCapture?.(event.pointerId)
}

const onPointerMove = (event: PointerEvent): void => {
  if (!dragStart || event.pointerId !== dragStart.id) return
  offset.value = {
    x: event.clientX - dragStart.x,
    y: event.clientY - dragStart.y,
  }
}

/** 松手：换到最近的角，再从松手处过渡过去（FLIP） */
const onPointerUp = async (event: PointerEvent): Promise<void> => {
  if (!dragStart || event.pointerId !== dragStart.id) return
  dragStart = null
  const el = frame.value
  if (!el) return
  const before = el.getBoundingClientRect()
  corner.value = nearestCorner(
    { x: before.left + before.width / 2, y: before.top + before.height / 2 },
    { width: window.innerWidth, height: window.innerHeight }
  )
  offset.value = { x: 0, y: 0 }
  await nextTick()
  const after = el.getBoundingClientRect()
  offset.value = { x: before.left - after.left, y: before.top - after.top }
  await nextTick()
  requestAnimationFrame(() => {
    settling.value = true
    offset.value = { x: 0, y: 0 }
  })
}

onMounted(() => setMiniSlot(slotEl.value))
onBeforeUnmount(() => {
  unbind?.()
  setMiniSlot(null)
})
</script>

<style scoped>
.mini-player {
  position: fixed;
  z-index: var(--z-player);
  width: min(320px, 50vw);
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--media-bg);
  box-shadow: var(--shadow-lg);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.mini-player:active {
  cursor: grabbing;
}

.mini-player.is-settling {
  transition: transform var(--duration-normal) var(--ease-out);
}

.is-top-left {
  top: var(--space-6);
  left: var(--space-6);
}

.is-top-right {
  top: var(--space-6);
  right: var(--space-6);
}

.is-bottom-left {
  bottom: var(--space-6);
  left: var(--space-6);
}

.is-bottom-right {
  right: var(--space-6);
  bottom: var(--space-6);
}

/* 手机宽度（与 usePlatform 的 isPhone 同一断点）网页版有底部导航：靠下的两个角让到导航之上 */
@media (max-width: 768px) {
  .is-bottom-left,
  .is-bottom-right {
    bottom: calc(
      var(--bottom-nav-height) + var(--safe-bottom) + var(--space-3)
    );
  }
}

.mini-player__slot {
  position: absolute;
  inset: 0;
  /* 播放器内部自带的层级关在这里，控制条才能盖在画面上 */
  isolation: isolate;
  pointer-events: none;
}

/* 搬进来的播放器离开了原组件的样式作用域，尺寸在这里重新铺满 */
.mini-player__slot :deep(.unified-player-core),
.mini-player__slot :deep(.art-video-player),
.mini-player__slot :deep(video) {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
  object-fit: contain;
  background: var(--media-bg);
}

/* 小窗只要画面：Artplayer 的控制条、提示、遮罩都不显示 */
.mini-player__slot :deep(.art-bottom),
.mini-player__slot :deep(.art-controls),
.mini-player__slot :deep(.art-mask),
.mini-player__slot :deep(.art-notice),
.mini-player__slot :deep(.art-poster) {
  display: none !important;
}

.mini-player__bar {
  position: absolute;
  inset: auto 0 0;
  display: flex;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2);
  background: linear-gradient(to top, var(--overlay-scrim), transparent);
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}

.mini-player:hover .mini-player__bar,
.mini-player:focus-within .mini-player__bar {
  opacity: 1;
}
</style>
