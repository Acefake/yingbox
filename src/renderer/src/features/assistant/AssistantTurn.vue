<template>
  <div class="assistant-turn">
    <p v-if="question" class="assistant-bubble">{{ question }}</p>
    <div
      v-if="answer || notice || result || $slots.default"
      class="assistant-reply"
    >
      <p
        v-if="answer"
        class="assistant-answer"
        :class="{ 'is-typing': typing }"
      >
        {{ answer }}
      </p>
      <p v-if="notice" class="assistant-notice">{{ notice }}</p>
      <slot />
      <AssistantResults
        v-if="result"
        :result="result"
        @played="emit('played')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 对话流里的一轮：你说的话（右对齐强调色气泡）、回答（左对齐普通文字，回答中末尾一个闪烁光标）、
 * 出错说明，以及回答下面的结果卡片。默认插槽放这一轮额外的操作（如「去设置 AI」）。
 */
import AssistantResults from './AssistantResults.vue'
import type { AssistantResult } from './skills/skill-types'

defineProps<{
  question: string
  answer: string
  result: AssistantResult | null
  notice: string
  /** 正在逐字显示回答 */
  typing?: boolean
}>()
const emit = defineEmits<{ played: [] }>()
</script>
