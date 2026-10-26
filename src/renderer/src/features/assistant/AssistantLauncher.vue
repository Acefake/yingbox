<template>
  <Transition name="assistant" :duration="transitionMs">
    <AssistantOverlay v-if="open" @close="onOverlayClose" />
  </Transition>
</template>

<script setup lang="ts">
/**
 * 统一入口（应用根组件挂一次）：搜索片库与问 AI 共用一个居中浮层（AssistantOverlay）。
 * 应用内 Cmd/Ctrl+K（或 Cmd/Ctrl+Shift+K）开合、Cmd/Ctrl+F 打开（assistant-hotkey.ts 的 entryHotkey），
 * 主进程全局快捷键（assistant.summon，窗口已被唤到前台）和侧栏的搜索框入口都经 assistant-open.ts 开合；
 * 浮层按需加载（defineAsyncComponent），第一次打开才下载。
 *
 * - 网页版也挂（片库搜索不需要主进程）；只有「问 AI」需要桌面端，浮层里自己判断；
 * - 全局快捷键新建了窗口时，挂载后经 takeSummon 取走待处理的唤起；
 * - 唤起 / 收起 {@link OPEN_MS}（与 tokens.css 的 --duration-assistant 一致），减少动态效果时不等动画；
 * - 私密模式（私密路由或在播私密内容）切换时清空对话上下文并收起浮层，私密对话不会带进普通模式；
 * - 私密模式下收起浮层也清空对话上下文（与问候里「关掉就不留记录」一致），下次打开不会带上一轮私密问题；
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

import { playerModal } from '@/features/player'

import { entryHotkey } from './assistant-hotkey'
import {
  closeAssistant,
  assistantOpen as open,
  openAssistant,
  toggleAssistant,
} from './assistant-open'
import { clearAssistantSession } from './assistant-session'
import { prepareLibrarySearch } from './library-search'
import { isPrivateRoute } from './skills/navigation-skill'

/** 浮层与它要用的片库搜索块一起取来再挂（library-search.ts） */
const AssistantOverlay = defineAsyncComponent(async () => {
  const [overlay] = await Promise.all([
    import('./AssistantOverlay.vue'),
    prepareLibrarySearch(),
  ])
  return overlay
})

const player = playerModal()
const route = useRoute()

/** 当前是否私密模式（与 assistantContext 的判断一致） */
const privateNow = computed(
  () => isPrivateRoute(route) || player.value?.payload.private === true
)

/** 唤起 / 收起的时长（与 tokens.css 的 --duration-assistant 一致） */
const OPEN_MS = 220

/** 减少动态效果时进出场不等动画 */
const transitionMs = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  .matches
  ? 0
  : OPEN_MS

function onOverlayClose(): void {
  void closeAssistant()
}

function onKeydown(event: KeyboardEvent): void {
  const action = entryHotkey(event)
  if (!action) return
  event.preventDefault()
  // 按住不放的自动重复不算（entryHotkey 已排除 repeat）
  if (action === 'toggle') toggleAssistant()
  else openAssistant()
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
