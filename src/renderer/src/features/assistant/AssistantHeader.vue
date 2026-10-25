<template>
  <header class="assistant-head">
    <AssistantOrb compact :phase="phase" :level="level" />
    <div class="assistant-chips">
      <span class="assistant-chip is-context">
        <i class="assistant-chip-dot" aria-hidden="true" />{{ contextLabel }}
      </span>
      <span v-if="modelLabel" class="assistant-chip">{{ modelLabel }}</span>
      <span v-if="isPrivate" class="assistant-chip">无痕：不留对话记录</span>
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
 * 助手面板顶部：小光球（各阶段动画）、上下文胶囊（当前页面或在播片名 · 时间点；私密模式显示
 * 「私密 · 仅本地模型」与无痕提示）、模型名、Esc 关闭提示（可点）。
 */
import { computed } from 'vue'

import { UiPressable } from '@/components/ui'

import AssistantOrb from './AssistantOrb.vue'
import { clockText } from './skills/skill-prompt'
import type { AssistantContext } from './skills/skill-types'
import type { AssistantPhase } from './use-assistant'

const props = defineProps<{
  phase: AssistantPhase
  level: number
  context: AssistantContext
  /** 当前对话模型（服务商 · 模型名） */
  modelLabel: string
}>()
const emit = defineEmits<{ close: [] }>()

const isPrivate = computed(() => props.context.private)

/** 上下文胶囊：私密 → 仅本地模型；在播 → 片名与时间点；否则页面名 */
const contextLabel = computed(() => {
  const { context } = props
  if (context.private) return '私密 · 仅本地模型'
  if (context.nowPlaying)
    return `在播 · ${context.nowPlaying.title} ${clockText(context.nowPlaying.seconds)}`
  return `${context.route.title} · ${context.playing ? '播放中' : '当前页面'}`
})
</script>
