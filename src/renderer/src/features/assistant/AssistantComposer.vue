<template>
  <div class="assistant-composer">
    <div
      class="assistant-field"
      :class="{ 'yb-glass': floating, 'is-busy': busy }"
    >
      <span class="assistant-streak" aria-hidden="true" />
      <UiIcon
        class="assistant-spark"
        :name="askable ? 'sparkle' : 'search'"
        size="lg"
      />
      <div class="assistant-entry" :class="{ 'has-example': example }">
        <UiInput
          ref="inputRef"
          v-model="draft"
          v-enter="onEnter"
          class="assistant-input"
          :placeholder="placeholder"
          :aria-label="placeholder"
          :maxlength="ASK_CHARS"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="Boolean(listId)"
          :aria-controls="listId || undefined"
          :aria-activedescendant="activeId || undefined"
          @keydown="onKeydown"
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
        v-if="askable"
        class="assistant-tool assistant-send"
        icon="arrowUp"
        label="问 AI"
        :disabled="!draft.trim()"
        @click="ask"
      />
    </div>
    <slot />
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
 * 默认插槽排在输入框下面（空闲时的搜索结果块），技能建议胶囊在最后。
 * 有 example 时占位后面跟一句更浅的示例：原生占位文字透明、由 .assistant-ghost 画出两种深浅，
 * 显隐跟着 :placeholder-shown 走（输入法组字时也会让开）。技能建议胶囊排在输入框下面。
 * 录音时麦克风按真实音量（level，0–1）轻微放大；减少动态效果时不缩放。打开时自动聚焦输入框。
 * 输入框也是搜索结果的 combobox（listId / activeId 由浮层给）：↑ ↓ 交给浮层移动选中（move），
 * 回车交给浮层决定打开选中的结果还是问 AI（enter），Cmd/Ctrl+回车与发送钮总是问 AI（ask）；组字中的回车不算。
 */
import { computed, onMounted, ref } from 'vue'

import { UiChip, UiIcon, UiIconButton, UiInput } from '@/components/ui'
import { vEnter } from '@/directives/enter'
import { isComposing } from '@/utils/keyboard'

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
    /** 能问 AI（网页版没有发送钮） */
    askable?: boolean
    /** 搜索结果列表的 id（有结果时） */
    listId?: string
    /** 当前选中行的 id */
    activeId?: string
  }>(),
  {
    example: '',
    level: 0,
    busy: false,
    floating: false,
    askable: true,
    listId: '',
    activeId: '',
  }
)
const emit = defineEmits<{
  ask: [text: string]
  enter: []
  move: [delta: 1 | -1]
  voice: []
}>()

/** 输入框里的字（浮层据此搜索） */
const draft = defineModel<string>('draft', { required: true })
const inputRef = ref<InstanceType<typeof UiInput> | null>(null)

const reducedMotion =
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
/** 录音时按音量放大麦克风（最多 1.2 倍） */
const micStyle = computed(() =>
  props.listening && !reducedMotion
    ? { transform: `scale(${(1 + Math.min(1, props.level) * 0.2).toFixed(3)})` }
    : undefined
)

function ask(): void {
  const text = draft.value.trim()
  if (text && props.askable) emit('ask', text)
}

function onEnter(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey) ask()
  else emit('enter')
}

function onKeydown(event: KeyboardEvent): void {
  if (isComposing(event)) return
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  emit('move', event.key === 'ArrowDown' ? 1 : -1)
}

onMounted(() => inputRef.value?.focus({ preventScroll: true }))
</script>
