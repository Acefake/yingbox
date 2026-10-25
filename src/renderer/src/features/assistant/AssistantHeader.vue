<template>
  <header class="assistant-head">
    <div class="assistant-chips">
      <span class="assistant-chip is-context">
        <UiIcon :name="contextIcon" size="sm" />{{ contextLabel }}
      </span>
      <span v-if="modelLabel" class="assistant-chip">{{ modelLabel }}</span>
      <span v-if="isPrivate" class="assistant-chip is-ghost">
        <UiIcon name="eyeOff" size="sm" />无痕：不留对话记录
      </span>
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
 * 助手面板顶部的上下文行：上下文胶囊（当前页面或在播片名 · 时间点；私密模式显示
 * 「私密 · 仅本地模型」与无痕提示）、模型名、Esc 关闭提示（可点）。全部中性灰，不带彩色。
 */
import { computed } from 'vue'

import { type IconName, UiIcon, UiPressable } from '@/components/ui'

import { clockText } from './skills/skill-prompt'
import type { AssistantContext } from './skills/skill-types'

const props = defineProps<{
  context: AssistantContext
  /** 当前对话模型名（设置 ai.model；空串时不显示） */
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
const contextIcon = computed<IconName>(() => {
  if (props.context.private) return 'lock'
  return props.context.nowPlaying || props.context.playing ? 'play' : 'home'
})
</script>
