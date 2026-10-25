<template>
  <div
    class="assistant"
    :data-phase="phase"
    :data-layout="layout"
    :data-private="context.private"
  >
    <div class="assistant-scrim" @click="close" />
    <section
      ref="sheetRef"
      class="assistant-drawer"
      role="dialog"
      :aria-modal="layout === 'page'"
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
      <div ref="threadRef" class="assistant-thread">
        <p class="assistant-status" role="status">{{ statusText }}</p>
        <div v-if="greeting" class="assistant-greeting">
          <h3 class="assistant-greeting-title">有什么可以帮你？</h3>
          <p class="assistant-greeting-hint">{{ greetingHint }}</p>
        </div>
        <AssistantTurn
          v-for="turn in turns"
          :key="turn.id"
          :question="turn.question"
          :answer="turn.answer"
          :result="turn.result"
          :notice="turn.notice"
          @played="close"
        />
        <AssistantTurn
          v-if="transcript || answer || notice || result"
          :question="transcript"
          :answer="answer"
          :result="result"
          :notice="notice"
          :typing="phase === 'answering'"
          @played="close"
        >
          <div v-if="needsSetup" class="assistant-setup">
            <UiButton
              variant="primary"
              icon="settings"
              label="去设置 AI"
              @click="openAiSettings"
            />
          </div>
        </AssistantTurn>
        <UiLoadingDots
          v-if="phase === 'thinking'"
          class="assistant-thinking"
          label="思考中"
        />
      </div>
      <AssistantComposer
        :suggestions="suggestions"
        :placeholder="placeholder"
        :voice-ready="voiceReady"
        :listening="phase === 'listening'"
        @ask="send"
        @voice="toggleVoice"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * AI 助手侧栏（按需加载）：固定在窗口右侧，背后轻度变暗，页面与播放器在侧栏后面照常可见、照常播放。
 * - 普通页面（layout = page）：模态（aria-modal + 焦点陷阱，use-focus-trap.ts），点变暗区收起；
 * - 内置播放器在前台（layout = player）：变暗区只是视觉，不拦点击，也不拦焦点，画面照常可点。
 * 侧栏由头部（光球、标题、场景副标题、Esc）、中间可滚动的对话流、底部建议芯片与输入框组成。
 * 对话流 = 本次打开期间归档的几轮（assistant-thread.ts）+ 当前这一轮；新内容出现时滚到底部。
 * 私密模式（data-private="true"）光球换低调靛蓝，副标题写「私密 · 仅本地模型 · 无痕」。
 * 状态行只给读屏用：待命且还没提问时为空。
 *
 * 第一次打开时登记内置技能包（之后打开不再重复登记）；提示词、建议与占位文字都来自当前生效的技能。
 * Esc（按层）、点变暗区、Esc 键帽都会收起；收起时取消模型调用、录音与逐字计时，
 * 侧栏卸载后光球的 CSS 动画一并停止。状态机在 use-assistant.ts，依赖在 assistant-deps.ts。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { UiButton, UiLoadingDots } from '@/components/ui'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { playerModal } from '@/features/player'
import { getSetting } from '@/features/settings'

import { assistantGreetingHint, assistantPlaceholder } from './assistant-copy'
import {
  assistantContext,
  assistantVoiceReady,
  createAssistantDeps,
  openSettingsSection,
} from './assistant-deps'
import { useAssistantThread } from './assistant-thread'
import AssistantComposer from './AssistantComposer.vue'
import AssistantHeader from './AssistantHeader.vue'
import AssistantTurn from './AssistantTurn.vue'
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
const { turns, archive } = useAssistantThread({
  transcript,
  answer,
  result,
  notice,
})

const player = playerModal()
/** 内置播放器在前台（不是小窗）时侧栏不做模态 */
const layout = computed(() =>
  player.value && !player.value.minimized ? 'player' : 'page'
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
const placeholder = computed(() =>
  skillPlaceholder(skills.value, assistantPlaceholder(context.value))
)
const voiceReady = computed(() => assistantVoiceReady(context.value.private))

const modelLabel = computed(() => getSetting('ai.model') || '')

const statusText = computed(() =>
  phase.value === 'idle' && !transcript.value ? '' : PHASE_LABELS[phase.value]
)

/** 还没问过：显示问候 */
const greeting = computed(
  () =>
    !turns.value.length &&
    !transcript.value &&
    !answer.value &&
    !notice.value &&
    phase.value !== 'listening'
)
const greetingHint = computed(() => assistantGreetingHint(context.value))

const sheetRef = ref<HTMLElement | null>(null)
const trapTab = useFocusTrap(sheetRef, () => layout.value === 'page')

/** 提问：先把上一轮归档进对话流 */
function send(text: string): void {
  archive()
  void ask(text)
}

function toggleVoice(): void {
  if (phase.value === 'listening') {
    void stopListening()
    return
  }
  archive()
  void listen()
}

function openAiSettings(): void {
  close()
  openSettingsSection('ai')
}

const threadRef = ref<HTMLElement | null>(null)

/** 对话流有新内容时滚到底部 */
watch([turns, transcript, answer, result, notice, phase], () => {
  void nextTick(() => {
    const el = threadRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
})

useEscapeLayer(() => true, close)

onBeforeUnmount(cancel)
</script>
