<template>
  <div
    class="assistant"
    :data-layout="layout"
    :data-private="context.private"
    :data-playing="player !== null"
  >
    <div v-if="layout === 'page'" class="assistant-scrim" @click="close" />
    <section
      ref="drawerRef"
      class="assistant-drawer yb-glass"
      role="dialog"
      :aria-modal="layout === 'page'"
      aria-label="AI 助手"
      @keydown="trapTab"
    >
      <AssistantHeader
        :context="context"
        :model-label="modelLabel"
        @close="close"
      />
      <div ref="threadRef" class="assistant-thread" @scroll="onThreadScroll">
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
          v-if="hasCurrent"
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
        :level="level"
        :busy="busy"
        @ask="send"
        @voice="toggleVoice"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * AI 助手侧栏（按需加载）：固定在窗口右侧的玻璃面板（.yb-glass），页面与播放器在侧栏后面照常可见。
 * - 普通页面（layout = page）：背后压暗轻模糊的遮罩，模态（aria-modal + 焦点陷阱，use-focus-trap.ts），点遮罩收起；
 * - 内置播放器在前台（layout = player）：没有遮罩，整层不拦点击、不拦焦点，画面照常可点。
 * 侧栏由头部（标题、场景副标题、Esc）、中间可滚动的对话流、底部技能胶囊与输入胶囊组成；
 * 唯一的彩色是输入胶囊上沿 1px 的蓝紫粉渐变，思考 / 回答时变亮。
 * 对话流 = 本次打开期间归档的几轮（assistant-thread.ts）+ 当前这一轮；新内容出现时，只有贴近底部时
 * 才自动滚到底部，用户上滚回看时不打扰，回到底部附近再恢复（assistant-scroll.ts）。
 * 「正在打开播放器」在所有轮次的结果间共享（assistant-opening.ts）。
 * 私密模式（data-private="true"）副标题写「私密 · 仅本地模型 · 无痕」，不换色调。
 * 状态行只给读屏用：待命且还没提问时为空。
 *
 * 第一次打开时登记内置技能包（之后打开不再重复登记）；提示词、建议与占位文字都来自当前生效的技能。
 * Esc（按层）、点遮罩、Esc 键帽都会收起；收起时取消模型调用、录音与逐字计时。
 * 状态机在 use-assistant.ts，依赖在 assistant-deps.ts。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
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
import { provideOpening } from './assistant-opening'
import { useStickyScroll } from './assistant-scroll'
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
import './assistant-results.css'

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
provideOpening()

const player = playerModal()
/** 内置播放器在前台（不是小窗）时侧栏不做模态、不加遮罩 */
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

/** 思考 / 回答中：输入胶囊上沿的渐变变亮 */
const busy = computed(
  () => phase.value === 'thinking' || phase.value === 'answering'
)

const statusText = computed(() =>
  phase.value === 'idle' && !transcript.value ? '' : PHASE_LABELS[phase.value]
)

/** 当前这一轮有内容（或需要先去设置 AI）时显示 */
const hasCurrent = computed(() =>
  Boolean(
    transcript.value ||
    answer.value ||
    notice.value ||
    result.value ||
    needsSetup.value
  )
)

/** 还没问过：显示问候 */
const greeting = computed(
  () => !turns.value.length && !hasCurrent.value && phase.value !== 'listening'
)
const greetingHint = computed(() => assistantGreetingHint(context.value))

const drawerRef = ref<HTMLElement | null>(null)
const trapTab = useFocusTrap(drawerRef, () => layout.value === 'page')

/** 提问：先把上一轮归档进对话流 */
function send(text: string): void {
  archive()
  stickToBottom()
  void ask(text)
}

function toggleVoice(): void {
  if (phase.value === 'listening') {
    void stopListening()
    return
  }
  archive()
  stickToBottom()
  void listen()
}

function openAiSettings(): void {
  close()
  openSettingsSection('ai')
}

const threadRef = ref<HTMLElement | null>(null)
const {
  onScroll: onThreadScroll,
  follow,
  stick: stickToBottom,
} = useStickyScroll(threadRef)

/** 对话流有新内容时：贴近底部才跟到底部 */
watch([turns, transcript, answer, result, notice, phase], follow)

useEscapeLayer(() => true, close)

onBeforeUnmount(cancel)
</script>
