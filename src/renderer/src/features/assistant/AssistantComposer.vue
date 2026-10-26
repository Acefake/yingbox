<template>
  <div class="assistant-composer">
    <div
      class="assistant-field"
      :class="{ 'yb-glass': floating, 'is-busy': busy }"
    >
      <span class="assistant-streak" aria-hidden="true" />
      <UiIcon class="assistant-spark" name="sparkle" size="lg" />
      <div class="assistant-entry" :class="{ 'has-example': example }">
        <UiInput
          ref="inputRef"
          v-model="draft"
          v-enter="submit"
          class="assistant-input"
          :placeholder="placeholder"
          :aria-label="placeholder"
          :maxlength="ASK_CHARS"
          autocomplete="off"
        />
        <span v-if="example" class="assistant-ghost" aria-hidden="true">
          {{ placeholder }}<em class="assistant-example">{{ example }}</em>
        </span>
      </div>
      <UiIconButton
        v-if="voiceReady"
        class="assistant-tool assistant-mic"
        :style="micStyle"
        icon="mic"
        :label="listening ? '停止录音' : '语音输入'"
        :active="listening"
        @click="emit('voice')"
      />
      <UiIconButton
        class="assistant-tool assistant-send"
        icon="arrowUp"
        label="发送"
        :disabled="!draft.trim()"
        @click="submit"
      />
    </div>
    <div v-if="suggestions.length" class="assistant-suggestions">
      <UiChip
        v-for="item in suggestions"
        :key="item"
        :label="item"
        @click="emit('ask', item)"
      >
        <template #leading>
          <UiIcon name="sparkle" size="sm" />
        </template>
      </UiChip>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 助手的输入胶囊：sparkle、输入框、麦克风与发送按钮；上沿一道 1px 蓝紫粉渐变（.assistant-streak），
 * 思考 / 回答中（busy）变亮。floating 时是独立的玻璃胶囊（还没提问），否则是面板底部的内凹胶囊。
 * 有 example 时占位后面跟一句更浅的示例：原生占位文字透明、由 .assistant-ghost 画出两种深浅，
 * 显隐跟着 :placeholder-shown 走（输入法组字时也会让开）。技能建议胶囊排在输入框下面。
 * 录音时麦克风按真实音量（level，0–1）轻微放大；减少动态效果时不缩放。回车或点发送提交，打开时自动聚焦输入框。
 */
import { computed, onMounted, ref } from 'vue'

import { UiChip, UiIcon, UiIconButton, UiInput } from '@/components/ui'
import { vEnter } from '@/directives/enter'

import { ASK_CHARS } from './skills/skill-prompt'

const props = withDefaults(
  defineProps<{
    suggestions: string[]
    placeholder: string
    /** 占位后面的浅色示例（空串不显示） */
    example?: string
    voiceReady: boolean
    listening: boolean
    /** 录音音量 0–1 */
    level?: number
    /** 思考 / 回答中 */
    busy?: boolean
    /** 独立的玻璃胶囊（还没提问时） */
    floating?: boolean
  }>(),
  { example: '', level: 0, busy: false, floating: false }
)
const emit = defineEmits<{ ask: [text: string]; voice: [] }>()

const draft = ref('')
const inputRef = ref<InstanceType<typeof UiInput> | null>(null)

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
/** 录音时按音量放大麦克风（最多 1.2 倍） */
const micStyle = computed(() =>
  props.listening && !reducedMotion
    ? { transform: `scale(${(1 + Math.min(1, props.level) * 0.2).toFixed(3)})` }
    : undefined
)

function submit(): void {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  emit('ask', text)
}

onMounted(() => inputRef.value?.focus({ preventScroll: true }))
</script>
