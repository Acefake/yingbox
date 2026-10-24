<template>
  <div class="assistant" :data-phase="phase">
    <div class="assistant-scrim" @click="close" />
    <EdgeGlow :phase="phase" />
    <section
      class="assistant-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="AI 助手"
    >
      <UiIconButton
        class="assistant-close"
        icon="close"
        label="关闭"
        variant="secondary"
        size="sm"
        @click="close"
      />
      <AssistantOrb :phase="phase" :level="level" />
      <p class="assistant-status" role="status">{{ statusText }}</p>
      <p v-if="transcript" class="assistant-transcript">{{ transcript }}</p>
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

      <div class="assistant-suggestions">
        <UiChip
          v-for="item in suggestions"
          :key="item"
          :label="item"
          @click="ask(item)"
        />
      </div>
      <UiInput
        ref="inputRef"
        v-model="draft"
        v-enter="submit"
        class="assistant-input"
        variant="filled"
        placeholder="问影盒…"
        aria-label="问影盒"
        :maxlength="ASK_CHARS"
        autocomplete="off"
      >
        <template #trailing>
          <UiIconButton
            v-if="voiceReady"
            icon="mic"
            :label="phase === 'listening' ? '停止录音' : '语音输入'"
            :active="phase === 'listening'"
            size="sm"
            @click="toggleVoice"
          />
          <UiIconButton
            icon="send"
            label="发送"
            size="sm"
            :disabled="!draft.trim()"
            @click="submit"
          />
        </template>
      </UiInput>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * AI 助手浮层（按需加载）：整窗边缘的彩色光圈、背景变暗模糊、底部面板（大光球、状态、
 * 你说的话、逐字出现的回答、结果卡片、建议胶囊与输入框「问影盒…」）。
 *
 * Esc（按层）、点面板外、关闭按钮都会收起；收起时取消进行中的模型调用、录音与逐字计时，
 * 浮层卸载后光圈与光球的 CSS 动画一并停止。状态机在 use-assistant.ts，依赖在 assistant-deps.ts。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { UiButton, UiChip, UiIconButton, UiInput } from '@/components/ui'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { vEnter } from '@/directives/enter'

import {
  assistantContext,
  createAssistantDeps,
  openSettingsSection,
} from './assistant-deps'
import { ASK_CHARS, assistantSuggestions } from './assistant-intents'
import AssistantOrb from './AssistantOrb.vue'
import AssistantResults from './AssistantResults.vue'
import EdgeGlow from './EdgeGlow.vue'
import { PHASE_LABELS, useAssistant } from './use-assistant'
import './assistant.css'

const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const route = useRoute()

const close = (): void => emit('close')

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

const deps = createAssistantDeps({ router, route, close, reducedMotion })
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

const voiceReady = Boolean(deps.voice)
const draft = ref('')
const inputRef = ref<InstanceType<typeof UiInput> | null>(null)

const suggestions = computed(() =>
  assistantSuggestions(assistantContext(route).playing)
)

const statusText = computed(() =>
  phase.value === 'idle' && !transcript.value
    ? '有什么可以帮你？'
    : PHASE_LABELS[phase.value]
)

function submit(): void {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  void ask(text)
}

function toggleVoice(): void {
  if (phase.value === 'listening') void stopListening()
  else void listen()
}

function openAiSettings(): void {
  close()
  openSettingsSection('ai')
}

useEscapeLayer(() => true, close)

onMounted(() => {
  void nextTick(() => inputRef.value?.focus({ preventScroll: true }))
})

onBeforeUnmount(cancel)
</script>
