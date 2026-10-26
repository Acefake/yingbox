<template>
  <header class="assistant-head">
    <ul class="assistant-context" aria-label="当前上下文">
      <li class="assistant-chip" :class="{ 'is-private': context.private }">
        <UiIcon :name="contextIcon" size="sm" />
        <span class="assistant-chip-text">{{ subtitle }}</span>
      </li>
      <li v-if="modelLabel" class="assistant-chip" title="当前对话模型">
        <span class="assistant-chip-text">{{ modelLabel }}</span>
      </li>
    </ul>
    <UiPressable
      v-if="closable"
      class="assistant-close"
      label="关闭（Esc）"
      @click="emit('close')"
    >
      <kbd class="assistant-kbd" aria-hidden="true">Esc</kbd>
    </UiPressable>
  </header>
</template>

<script setup lang="ts">
/**
 * 助手顶上的一排上下文胶囊：场景（在播片名 · 时间点 / 页面 · 当前页面；私密模式只写
 * 「私密 · 仅本地模型 · 无痕」，见 assistant-copy.ts）与当前对话模型名。
 * 场景胶囊前一枚图标（私密为划掉的眼睛、在播为播放、否则主页）；私密胶囊是描边样式，仍是中性灰，不靠颜色区分。
 * closable 时（有对话、面板展开）右侧加一枚可点的 Esc 键帽；空闲时关闭入口在下面的快捷键提示里。
 */
import { computed } from 'vue'

import { type IconName, UiIcon, UiPressable } from '@/components/ui'

import { assistantSubtitle } from './assistant-copy'
import type { AssistantContext } from './skills/skill-types'

const props = defineProps<{
  context: AssistantContext
  /** 当前对话模型名（设置 ai.model；空串时不显示） */
  modelLabel: string
  /** 右侧显示 Esc 键帽 */
  closable?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const subtitle = computed(() => assistantSubtitle(props.context))
const contextIcon = computed<IconName>(() => {
  if (props.context.private) return 'eyeOff'
  return props.context.nowPlaying || props.context.playing ? 'play' : 'home'
})
</script>
