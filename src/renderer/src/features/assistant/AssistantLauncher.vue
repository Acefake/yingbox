<template>
  <template v-if="enabled">
    <UiPressable
      v-show="showOrb"
      ref="fabRef"
      class="assistant-fab"
      label="AI 助手"
      @click="openAssistant"
    >
      <UiIcon name="sparkle" />
    </UiPressable>
    <Transition name="assistant" :duration="transitionMs">
      <AssistantOverlay v-if="open" @close="onOverlayClose" />
    </Transition>
  </template>
</template>

<script setup lang="ts">
/**
 * AI 助手的入口（应用根组件挂一次）：右下角的光球按钮、应用内 Cmd/Ctrl+K、主进程全局快捷键
 * （assistant.summon，窗口已被唤到前台）。三种入口打开的是同一个右侧侧栏（AssistantOverlay），
 * 按需加载（defineAsyncComponent），第一次打开才下载。
 *
 * - 只在桌面端出现（AI 调用需要主进程）；
 * - 播放弹窗或角落小窗在时不显示光球（小窗也在右下角），快捷键照常可用；
 * - 光球用 v-show（节点常驻），收起时等它重新显示后把焦点还给打开前的元素；
 * - 全局快捷键新建了窗口时，挂载后经 takeSummon 取走待处理的唤起；
 * - 减少动态效果时进出场不等动画；
 * - 私密模式（私密路由或在播私密内容）切换时清空对话上下文并收起浮层，私密对话不会带进普通模式；
 *   私密技能的开关关掉时，私密技能卸载也会清空（private-skills.ts）。
 */
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useRoute } from 'vue-router'

import { UiIcon, UiPressable } from '@/components/ui'
import { aiAvailable } from '@/features/ai'
import { playerModal } from '@/features/player'

import { isAssistantHotkey } from './assistant-hotkey'
import { clearAssistantSession } from './assistant-session'
import { isPrivateRoute } from './skills/navigation-skill'

const AssistantOverlay = defineAsyncComponent(
  () => import('./AssistantOverlay.vue')
)

const enabled = aiAvailable()
const open = ref(false)
const player = playerModal()
const showOrb = computed(() => !open.value && player.value === null)
const route = useRoute()

/** 当前是否私密模式（与 assistantContext 的判断一致） */
const privateNow = computed(
  () => isPrivateRoute(route) || player.value?.payload.private === true
)

/** 侧栏滑入 / 滑出的时长（与 tokens.css 的 --duration-assistant-drawer 一致） */
const DRAWER_MS = 220

/** 减少动态效果时进出场不等动画 */
const transitionMs = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  .matches
  ? 0
  : DRAWER_MS

const fabRef = ref<{ $el: HTMLElement } | null>(null)
let returnFocus: HTMLElement | null = null

function openAssistant(): void {
  if (open.value) return
  returnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  open.value = true
}

async function closeAssistant(): Promise<void> {
  if (!open.value) return
  open.value = false
  const target = returnFocus
  returnFocus = null
  // 等光球（v-show）重新显示后再聚焦，否则落到 body
  await nextTick()
  const fallback = showOrb.value ? fabRef.value?.$el : null
  const next = target?.isConnected ? target : fallback
  next?.focus({ preventScroll: true })
}

function onOverlayClose(): void {
  void closeAssistant()
}

function onKeydown(event: KeyboardEvent): void {
  if (!isAssistantHotkey(event)) return
  event.preventDefault()
  // 按住不放的自动重复不算（isAssistantHotkey 已排除 repeat）
  if (open.value) void closeAssistant()
  else openAssistant()
}

watch(privateNow, () => {
  clearAssistantSession()
  void closeAssistant()
})

const bridge = window.api?.assistant

onMounted(async () => {
  if (!enabled) return
  window.addEventListener('keydown', onKeydown)
  bridge?.onSummon(openAssistant)
  if (await bridge?.takeSummon().catch(() => false)) openAssistant()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  bridge?.offSummon()
})
</script>

<style>
.assistant-fab {
  position: fixed;
  right: var(--space-6);
  bottom: var(--space-6);
  z-index: var(--z-overlay-top);
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 32% 28%,
    color-mix(in srgb, var(--assistant-violet) 45%, var(--text-on-accent)) 0,
    var(--assistant-violet) 34%,
    var(--assistant-indigo) 100%
  );
  box-shadow:
    inset 0 0 0 1px var(--border-glass-light),
    0 8px 30px var(--assistant-glow);
  color: var(--text-on-accent);
  animation: assistant-fab-breathe var(--duration-assistant-breathe) ease-in-out
    infinite;
}
.assistant-fab::after {
  content: '';
  position: absolute;
  inset: calc(var(--space-1) * -1.5);
  border: 1.5px solid var(--assistant-violet);
  border-radius: 50%;
  opacity: 0;
  animation: assistant-fab-ping var(--duration-assistant-breathe) ease-out
    infinite;
  pointer-events: none;
}
.assistant-fab:hover {
  animation-play-state: paused;
}
@keyframes assistant-fab-breathe {
  50% {
    transform: scale(1.06);
  }
}
@keyframes assistant-fab-ping {
  0% {
    opacity: 0.9;
    transform: scale(0.9);
  }
  70%,
  100% {
    opacity: 0;
    transform: scale(1.35);
  }
}
@media (prefers-reduced-motion: reduce) {
  .assistant-fab,
  .assistant-fab::after {
    animation: none;
  }
}
</style>
