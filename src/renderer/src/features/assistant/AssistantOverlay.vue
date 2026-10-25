<template>
  <div
    class="assistant"
    :data-phase="phase"
    :data-layout="layout"
    :data-private="context.private"
    :data-playing="player !== null"
    :data-expanded="expanded"
  >
    <div v-if="layout === 'sheet'" class="assistant-scrim" @click="close" />
    <section
      ref="sheetRef"
      class="assistant-sheet"
      :class="{ 'yb-glass': expanded }"
      role="dialog"
      :aria-modal="layout === 'sheet'"
      aria-label="AI 助手"
      @keydown="trapTab"
    >
      <h2 v-if="!expanded" class="assistant-hello" aria-hidden="true">
        有什么可以帮你？
      </h2>
      <AssistantHeader
        :context="context"
        :model-label="modelLabel"
        @close="close"
      />
      <div class="assistant-body">
        <p class="assistant-status" role="status">{{ statusText }}</p>
        <h2 class="assistant-transcript" :class="{ 'is-empty': !transcript }">
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
        :suggestions="expanded ? [] : suggestions"
        :placeholder="placeholder"
        :voice-ready="voiceReady"
        :listening="phase === 'listening'"
        :level="level"
        :busy="busy"
        :floating="!expanded"
        @ask="ask"
        @voice="toggleVoice"
      />
      <p v-if="!expanded" class="assistant-hints" aria-hidden="true">
        <span><kbd>↵</kbd>发送</span>
        <span
          ><kbd>{{ hotkeyLabel }}</kbd
          >唤起 / 收起</span
        >
        <span><kbd>Esc</kbd>关闭</span>
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * AI 助手浮层（按需加载）。两种布局：
 * - sheet：背景压暗轻模糊；还没提问时窗口中间偏上一条玻璃输入胶囊 + 技能胶囊 + 快捷键提示，
 *   提问后同一个面板展开成玻璃面板（.yb-glass），输入框收进面板底部。模态（aria-modal + 焦点陷阱，use-focus-trap.ts）；
 * - side：内置播放器在前台时用右侧玻璃面板，不加遮罩、不挡画面，不拦焦点。
 * 面板顶部（上下文胶囊、关闭）与底部输入框固定，只有中间的回答与结果区滚动。
 * 唯一的彩色是输入胶囊上沿 1px 的蓝紫粉渐变，思考 / 回答时变亮；小窗在播时（data-playing）遮罩不做实时模糊。
 * 私密模式（data-private="true"）只在上下文胶囊里写「私密 · 仅本地模型」与无痕提示，不换色调。
 * 状态行只给读屏用：待命且还没提问时为空，避免与大标题重复朗读。
 *
 * 第一次打开时登记内置技能包（之后打开不再重复登记）；提示词、建议与占位文字都来自当前生效的技能。
 * Esc（按层）、点面板外、Esc 提示都会收起；收起时取消模型调用、录音与逐字计时。
 * 状态机在 use-assistant.ts，依赖在 assistant-deps.ts。
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
import { ASSISTANT_HOTKEY_LABEL } from './assistant-hotkey'
import AssistantHeader from './AssistantHeader.vue'
import AssistantResults from './AssistantResults.vue'
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

/** 提问过（或在播放器旁）就展开成面板；待命且没提问时只有输入胶囊 */
const expanded = computed(
  () =>
    layout.value === 'side' ||
    Boolean(transcript.value || answer.value || result.value || notice.value) ||
    needsSetup.value
)
/** 思考 / 回答中：输入胶囊上沿的渐变变亮 */
const busy = computed(
  () => phase.value === 'thinking' || phase.value === 'answering'
)
const hotkeyLabel = ASSISTANT_HOTKEY_LABEL

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
