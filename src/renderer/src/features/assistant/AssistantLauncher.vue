<template>
  <template v-if="enabled">
    <UiPressable
      v-if="showOrb"
      class="assistant-fab"
      label="AI 助手"
      @click="openAssistant"
    >
      <UiIcon name="sparkle" />
    </UiPressable>
    <Transition name="assistant" :duration="{ enter: 550, leave: 240 }">
      <AssistantOverlay v-if="open" @close="closeAssistant" />
    </Transition>
  </template>
</template>

<script setup lang="ts">
/**
 * AI 助手的入口（应用根组件挂一次）：右下角的光球按钮、应用内 Cmd/Ctrl+K、主进程全局快捷键
 * （assistant.summon，窗口已被唤到前台）。浮层按需加载（defineAsyncComponent），第一次打开才下载。
 *
 * - 只在桌面端出现（AI 调用需要主进程）；
 * - 播放弹窗或角落小窗在时不显示光球（小窗也在右下角），快捷键照常可用；
 * - 收起时把焦点还给打开前的元素。
 */
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
} from 'vue'

import { UiIcon, UiPressable } from '@/components/ui'
import { aiAvailable } from '@/features/ai'
import { playerModal } from '@/features/player'

import { isAssistantHotkey } from './assistant-hotkey'

const AssistantOverlay = defineAsyncComponent(
  () => import('./AssistantOverlay.vue')
)

const enabled = aiAvailable()
const open = ref(false)
const player = playerModal()
const showOrb = computed(() => !open.value && player.value === null)

let returnFocus: HTMLElement | null = null

function openAssistant(): void {
  if (open.value) return
  returnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  open.value = true
}

function closeAssistant(): void {
  if (!open.value) return
  open.value = false
  returnFocus?.focus({ preventScroll: true })
  returnFocus = null
}

function onKeydown(event: KeyboardEvent): void {
  if (!isAssistantHotkey(event)) return
  event.preventDefault()
  if (open.value) closeAssistant()
  else openAssistant()
}

const bridge = window.api?.assistant

onMounted(() => {
  if (!enabled) return
  window.addEventListener('keydown', onKeydown)
  bridge?.onSummon(openAssistant)
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
