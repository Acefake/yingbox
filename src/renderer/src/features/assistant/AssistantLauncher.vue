<template>
  <Transition v-if="enabled" name="assistant" :duration="transitionMs">
    <AssistantOverlay v-if="open" @close="onOverlayClose" />
  </Transition>
</template>

<script setup lang="ts">
/**
 * AI 助手的入口（应用根组件挂一次）：应用内 Cmd/Ctrl+K、主进程全局快捷键（assistant.summon，
 * 窗口已被唤到前台）和侧栏的 sparkle 按钮都经 assistant-open.ts 开合，打开的是同一个右侧侧栏
 * （AssistantOverlay）；侧栏按需加载（defineAsyncComponent），第一次打开才下载。
 *
 * - 只在桌面端出现（AI 调用需要主进程）；
 * - 全局快捷键新建了窗口时，挂载后经 takeSummon 取走待处理的唤起；
 * - 侧栏滑入 / 滑出 {@link DRAWER_MS}（与 tokens.css 的 --duration-assistant-drawer 一致），减少动态效果时不等动画；
 * - 私密模式（私密路由或在播私密内容）切换时清空对话上下文并收起侧栏，私密对话不会带进普通模式；
 * - 私密模式下收起侧栏也清空对话上下文（与问候里「关掉就不留记录」一致），下次打开不会带上一轮私密问题；
 *   私密技能的开关关掉时，私密技能卸载也会清空（private-skills.ts）。
 */
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  watch,
} from 'vue'
import { useRoute } from 'vue-router'

import { aiAvailable } from '@/features/ai'
import { playerModal } from '@/features/player'

import { isAssistantHotkey } from './assistant-hotkey'
import {
  closeAssistant,
  assistantOpen as open,
  openAssistant,
  toggleAssistant,
} from './assistant-open'
import { clearAssistantSession } from './assistant-session'
import { isPrivateRoute } from './skills/navigation-skill'

const AssistantOverlay = defineAsyncComponent(
  () => import('./AssistantOverlay.vue')
)

const enabled = aiAvailable()
const player = playerModal()
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

function onOverlayClose(): void {
  void closeAssistant()
}

function onKeydown(event: KeyboardEvent): void {
  if (!isAssistantHotkey(event)) return
  event.preventDefault()
  // 按住不放的自动重复不算（isAssistantHotkey 已排除 repeat）
  toggleAssistant()
}

watch(privateNow, () => {
  clearAssistantSession()
  void closeAssistant()
})

// 私密模式下收起（Esc、点遮罩、快捷键、侧栏入口都算）：不留对话上下文
watch(open, isOpen => {
  if (!isOpen && privateNow.value) clearAssistantSession()
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
  void closeAssistant()
})
</script>
