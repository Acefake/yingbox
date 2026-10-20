<template>
  <div class="agent-composer-dock">
    <form class="agent-composer" @submit.prevent="emit('send')">
      <UiTextarea
        v-model="draft"
        rows="2"
        placeholder="向片库提问…"
        aria-label="输入消息"
        :disabled="inputDisabled"
        @keydown="composerKey"
      />
      <div class="agent-composer-actions">
        <label
          >思考<UiSelect
            class="agent-thinking-select"
            size="sm"
            aria-label="思考强度"
            :value="thinking"
            :disabled="thinkingDisabled"
            @change="
              emit('thinking', ($event.target as HTMLSelectElement).value)
            "
          >
            <option value="">跟随全局设置</option>
            <option
              v-for="mode in THINKING_MODES"
              :key="mode.value"
              :value="mode.value"
            >
              {{ mode.label }}
            </option>
          </UiSelect></label
        ><span>Enter 发送，Shift + Enter 换行</span
        ><UiIconButton
          v-if="running"
          icon="stop"
          label="停止生成"
          :disabled="busy"
          @click="emit('stop')"
        /><UiIconButton
          v-else
          icon="arrowUp"
          label="发送消息"
          :disabled="sendDisabled"
          @click="emit('send')"
        />
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
/** 消息输入区：Enter 发送（输入法组字时不发）、Shift+Enter 换行、思考强度、停止生成。 */
import { UiIconButton, UiSelect, UiTextarea } from '@/components/ui'
import { THINKING_MODES } from '../../utils/agent'

defineProps<{
  /** 当前会话的思考强度（空串 = 跟随全局） */
  thinking: string
  inputDisabled: boolean
  thinkingDisabled: boolean
  sendDisabled: boolean
  running: boolean
  busy: boolean
}>()
const draft = defineModel<string>({ required: true })
const emit = defineEmits<{ send: []; stop: []; thinking: [value: string] }>()

function composerKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    emit('send')
  }
}
</script>
