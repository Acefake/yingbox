<template>
  <div class="assistant-turn">
    <p v-if="question" class="assistant-question">{{ question }}</p>
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
 * 对话流里的一轮：你说的话（加粗的标题行）、回答（次级灰的正文，回答中末尾一个闪烁光标）、
 * 出错说明，以及回答下面的结果卡片；轮与轮之间一道发丝分隔线。默认插槽放这一轮额外的操作（如「去设置 AI」）。
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
