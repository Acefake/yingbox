<template>
  <div
    class="assistant"
    :data-phase="phase"
    :data-layout="layout"
    :data-private="context.private"
    :data-playing="player !== null"
  >
    <div v-if="layout === 'sheet'" class="assistant-scrim" @click="close" />
    <EdgeGlow :phase="phase" />
    <section
      ref="sheetRef"
      class="assistant-sheet"
      role="dialog"
      :aria-modal="layout === 'sheet'"
      aria-label="AI 助手"
      @keydown="trapTab"
    >
      <AssistantHeader
        :phase="phase"
        :level="level"
        :context="context"
        :model-label="modelLabel"
        @close="close"
      />
      <div class="assistant-body">
        <p class="assistant-status" role="status">{{ statusText }}</p>
        <h2 class="assistant-transcript">
          {{ transcript || '有什么可以帮你？' }}
        </h2>
        <p
          v-if="answer"
          class="assistant-answer"
          :class="{ 'is-typing': phase === 'answering' }"
        >
          {{ answer }}
        </p>
        <p v-if="notice" class="assistant-notice">{{ notice }}</p>
        <div v-if="needsSetup" class="assistant-setup">
          <UiButton
            variant="primary"
            icon="settings"
            label="去设置 AI"
            @click="openAiSettings"
          />
        </div>
        <AssistantResults v-if="result" :result="result" @played="close" />
      </div>
      <AssistantComposer
        :suggestions="suggestions"
        :placeholder="placeholder"
        :voice-ready="voiceReady"
        :listening="phase === 'listening'"
        @ask="ask"
        @voice="toggleVoice"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * AI 助手浮层（按需加载）。两种布局：
 * - sheet：整窗边缘光圈、背景变暗模糊、底部居中卡片式面板；模态（aria-modal + 焦点陷阱，use-focus-trap.ts）；
 * - side：内置播放器在前台时用右侧面板，不加遮罩、不挡画面，不拦焦点。
 * 面板顶部（关闭按钮）与底部输入框固定，只有中间的回答与结果区滚动。
 * 小窗在播时（data-playing）遮罩不做实时模糊、光圈不加外发光，减少播放时的重绘。
 * 私密模式（data-private="true"）换低调靛蓝光圈，顶部显示「私密 · 仅本地模型」。
 * 状态行只给读屏用：待命且还没提问时为空，避免与大标题重复朗读。
 *
 * 第一次打开时登记内置技能包（之后打开不再重复登记）；提示词、建议与占位文字都来自当前生效的技能。
 * Esc（按层）、点面板外、Esc 提示都会收起；收起时取消模型调用、录音与逐字计时，
 * 浮层卸载后光圈与光球的 CSS 动画一并停止。状态机在 use-assistant.ts，依赖在 assistant-deps.ts。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { UiButton } from '@/components/ui'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { playerModal } from '@/features/player'
import { getSetting } from '@/features/settings'

import {
  assistantContext,
  assistantVoiceReady,
  createAssistantDeps,
  openSettingsSection,
} from './assistant-deps'
import AssistantComposer from './AssistantComposer.vue'
import AssistantHeader from './AssistantHeader.vue'
import AssistantResults from './AssistantResults.vue'
import EdgeGlow from './EdgeGlow.vue'
import { ensureCoreSkills } from './skills/core-skills'
import { skillPlaceholder, skillSuggestions } from './skills/skill-prompt'
import { assistantSkills } from './skills/skill-registry'
import { PHASE_LABELS, useAssistant } from './use-assistant'
import { useFocusTrap } from './use-focus-trap'
import './assistant.css'
import './assistant-panel.css'

const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const route = useRoute()

const close = (): void => emit('close')

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

ensureCoreSkills(assistantSkills, router)

const deps = createAssistantDeps({
  router,
  route,
  registry: assistantSkills,
  close,
  reducedMotion,
})
const {
  phase,
  transcript,
  answer,
  result,
  notice,
  needsSetup,
  level,
  ask,
  listen,
  stopListening,
  cancel,
} = useAssistant(deps)

const player = playerModal()
/** 内置播放器在前台（不是小窗）时用右侧面板 */
const layout = computed(() =>
  player.value && !player.value.minimized ? 'side' : 'sheet'
)

/** 打开时的状态（在播时间点不随播放刷新，下次提问时重新取） */
const context = computed(() => {
  void phase.value
  return assistantContext(route)
})
const skills = computed(() => assistantSkills.active(context.value))
const suggestions = computed(() =>
  skillSuggestions(skills.value, context.value)
)
const placeholder = computed(() => skillPlaceholder(skills.value, '问影盒…'))
const voiceReady = computed(() => assistantVoiceReady(context.value.private))

const modelLabel = computed(() => getSetting('ai.model') || '')

const statusText = computed(() =>
  phase.value === 'idle' && !transcript.value ? '' : PHASE_LABELS[phase.value]
)

const sheetRef = ref<HTMLElement | null>(null)
const trapTab = useFocusTrap(sheetRef, () => layout.value === 'sheet')

function toggleVoice(): void {
  if (phase.value === 'listening') void stopListening()
  else void listen()
}

function openAiSettings(): void {
  close()
  openSettingsSection('ai')
}

useEscapeLayer(() => true, close)

onBeforeUnmount(cancel)
</script>
