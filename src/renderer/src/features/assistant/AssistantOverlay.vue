<template>
  <div
    class="assistant"
    data-focus-scope
    :data-layout="layout"
    :data-mode="mode"
    :data-private="context.private"
    :data-playing="player !== null"
  >
    <div v-if="layout === 'page'" class="assistant-scrim" @click="close" />
    <div class="assistant-stage">
      <section
        ref="panelRef"
        class="assistant-panel"
        :class="{ 'yb-glass': mode === 'panel' }"
        role="dialog"
        :aria-modal="layout === 'page'"
        aria-label="AI 助手"
        @keydown="trapTab"
      >
        <p class="assistant-status" role="status">{{ statusText }}</p>
        <h2 v-if="mode === 'hero'" class="assistant-hello">有什么可以帮你？</h2>
        <AssistantHeader
          :context="context"
          :model-label="modelLabel"
          :closable="mode === 'panel'"
          @close="close"
        />
        <div
          v-if="threaded"
          ref="threadRef"
          class="assistant-thread"
          @scroll="onThreadScroll"
        >
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
          :suggestions="threaded ? [] : suggestions"
          :placeholder="threaded ? '继续问…' : placeholder"
          :example="threaded ? '' : example"
          :floating="mode === 'hero'"
          :voice-ready="voiceReady"
          :listening="phase === 'listening'"
          :level="level"
          :busy="busy"
          @ask="send"
          @voice="toggleVoice"
        />
        <footer v-if="mode === 'hero'" class="assistant-keys">
          <span class="assistant-key">
            <kbd class="assistant-kbd" aria-hidden="true">↵</kbd>发送
          </span>
          <span class="assistant-key">
            <kbd class="assistant-kbd" aria-hidden="true">{{ hotkey }}</kbd>
            唤起 / 收起
          </span>
          <UiPressable
            class="assistant-key assistant-close"
            label="关闭（Esc）"
            @click="close"
          >
            <kbd class="assistant-kbd" aria-hidden="true">Esc</kbd>
            <span aria-hidden="true">关闭</span>
          </UiPressable>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * AI 助手浮层（按需加载）：窗口正中的一列，两种形态（data-mode）。
 * - hero（还没提问）：大标题「有什么可以帮你？」、上下文胶囊、独立的玻璃输入胶囊、技能建议、快捷键提示；
 * - panel（有对话后）：同一列展开成玻璃面板（.yb-glass）——上下文胶囊与 Esc 在顶、对话流在中间滚动、
 *   内凹输入胶囊在底；面板随内容长高，最高 --assistant-panel-height，超出后只有对话流滚动。
 * 两种布局（data-layout）：
 * - 普通页面（page）：整窗压暗轻模糊的遮罩，模态（aria-modal + 焦点陷阱，use-focus-trap.ts），点遮罩收起；
 * - 内置播放器在前台（player）：没有遮罩，整层不拦点击、不拦焦点，画面照常可点；
 *   画面上没有遮罩托底，所以一律用面板形态（文字落在玻璃上才读得清）。
 * 唯一的彩色是输入胶囊上沿 1px 的蓝紫粉渐变，思考 / 回答时变亮。
 * 对话流 = 本次打开期间归档的几轮（assistant-thread.ts）+ 当前这一轮；新内容出现时，只有贴近底部时
 * 才自动滚到底部，用户上滚回看时不打扰，回到底部附近再恢复（assistant-scroll.ts）。
 * 「正在打开播放器」在所有轮次的结果间共享（assistant-opening.ts）。
 * 根上的 data-focus-scope 让下面播放弹窗的焦点陷阱放行：点进助手输入框不会被拉回播放器。
 * 私密模式（data-private="true"）上下文胶囊写「私密 · 仅本地模型 · 无痕」，不举例、不换色调。
 * 状态行只给读屏用：待命且还没提问时为空。
 *
 * 第一次打开时登记内置技能包（之后打开不再重复登记）；提示词、建议与占位文字都来自当前生效的技能。
 * Esc（按层）、点遮罩、Esc 键帽（面板顶部或快捷键提示里）都会收起；收起时取消模型调用、录音与逐字计时。
 * 状态机在 use-assistant.ts，依赖在 assistant-deps.ts。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { UiButton, UiLoadingDots, UiPressable } from '@/components/ui'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { useFocusTrap } from '@/composables/use-focus-trap'
import { playerModal } from '@/features/player'
import { getSetting } from '@/features/settings'

import { assistantExample, assistantPlaceholder } from './assistant-copy'
import {
  assistantContext,
  assistantVoiceReady,
  createAssistantDeps,
  openSettingsSection,
} from './assistant-deps'
import { ASSISTANT_HOTKEY_LABEL as hotkey } from './assistant-hotkey'
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
/** 内置播放器在前台（不是小窗）时不做模态、不加遮罩 */
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

/** 有对话（归档的轮次或当前这一轮）：展开对话流 */
const threaded = computed(() => turns.value.length > 0 || hasCurrent.value)
/** 播放器在前台时一律面板形态，否则有对话才展开 */
const mode = computed(() =>
  threaded.value || layout.value === 'player' ? 'panel' : 'hero'
)
const example = computed(() => assistantExample(context.value))

const panelRef = ref<HTMLElement | null>(null)
const trapTab = useFocusTrap(panelRef, () => layout.value === 'page')

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
