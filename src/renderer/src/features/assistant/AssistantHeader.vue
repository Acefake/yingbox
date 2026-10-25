<template>
  <header class="assistant-head">
    <AssistantOrb :phase="phase" :level="level" />
    <div class="assistant-heading">
      <h2 class="assistant-title">影盒助手</h2>
      <p class="assistant-subtitle" :title="modelLabel || undefined">
        {{ subtitle }}
      </p>
    </div>
    <UiPressable
      class="assistant-close"
      label="关闭（Esc）"
      @click="emit('close')"
    >
      <kbd class="assistant-esc" aria-hidden="true">Esc</kbd>
    </UiPressable>
  </header>
</template>

<script setup lang="ts">
/**
 * 侧栏头部：小光球（各阶段动画）、标题「影盒助手」、一行场景副标题（在播片名 · 时间点、当前页面，
 * 私密模式写「私密 · 仅本地模型 · 无痕」，见 assistant-copy.ts）、右侧 Esc 键帽（可点关闭）。
 * 当前对话模型名放在副标题的悬停提示里。
 */
import { computed } from 'vue'

import { UiPressable } from '@/components/ui'

import { assistantSubtitle } from './assistant-copy'
import AssistantOrb from './AssistantOrb.vue'
import type { AssistantContext } from './skills/skill-types'
import type { AssistantPhase } from './use-assistant'

const props = defineProps<{
  phase: AssistantPhase
  level: number
  context: AssistantContext
  /** 当前对话模型名（设置 ai.model；空串时不显示） */
  modelLabel: string
}>()
const emit = defineEmits<{ close: [] }>()

const subtitle = computed(() => assistantSubtitle(props.context))
</script>
