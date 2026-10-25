<template>
  <div class="assistant-composer">
    <div v-if="suggestions.length" class="assistant-suggestions">
      <UiChip
        v-for="item in suggestions"
        :key="item"
        :label="item"
        @click="emit('ask', item)"
      />
    </div>
    <UiInput
      ref="inputRef"
      v-model="draft"
      v-enter="submit"
      class="assistant-input"
      variant="filled"
      :placeholder="placeholder"
      :aria-label="placeholder"
      :maxlength="ASK_CHARS"
      autocomplete="off"
    >
      <template #trailing>
        <UiIconButton
          v-if="voiceReady"
          class="assistant-tool"
          icon="mic"
          :label="listening ? '停止录音' : '语音输入'"
          :active="listening"
          variant="secondary"
          size="sm"
          @click="emit('voice')"
        />
        <UiIconButton
          class="assistant-tool assistant-send"
          icon="arrowUp"
          label="发送"
          size="sm"
          :disabled="!draft.trim()"
          @click="submit"
        />
      </template>
    </UiInput>
  </div>
</template>

<script setup lang="ts">
/**
 * 侧栏底部：一排建议芯片，下面是输入框（右侧麦克风按钮与白色圆形发送按钮）。
 * 回车或点发送提交，打开时自动聚焦输入框。
 */
import { onMounted, ref } from 'vue'

import { UiChip, UiIconButton, UiInput } from '@/components/ui'
import { vEnter } from '@/directives/enter'

import { ASK_CHARS } from './skills/skill-prompt'

defineProps<{
  suggestions: string[]
  placeholder: string
  voiceReady: boolean
  listening: boolean
}>()
const emit = defineEmits<{ ask: [text: string]; voice: [] }>()

const draft = ref('')
const inputRef = ref<InstanceType<typeof UiInput> | null>(null)

function submit(): void {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  emit('ask', text)
}

onMounted(() => inputRef.value?.focus({ preventScroll: true }))
</script>
