<template>
  <UiButton
    variant="plain"
    size="sm"
    icon="sparkle"
    :label="label"
    :loading="running"
    :disabled="disabled || running"
    @click="start"
  />
</template>

<script setup lang="ts">
/**
 * 「用 AI 识别」按钮：对指定条目或若干媒体库里的待确认 / 未匹配条目排队 AI 识别，
 * 结束后提示合计结果并发出 done（匹配面板据此重新读取候选）。
 */
import { toast } from '@/components/ui'
import { ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'

import { errorText, libraryBridge } from '../api/bridge'
import { type AiIdentifyScope, runAiIdentify } from './ai-scrape-api'
import { aiDoneText } from './ai-scrape-rules'

const props = defineProps<{
  scope: AiIdentifyScope
  label: string
  disabled?: boolean
}>()
const emit = defineEmits<{ done: [] }>()

const running = ref(false)

async function start(): Promise<void> {
  const bridge = libraryBridge()
  if (!bridge || running.value) return
  running.value = true
  toast.info('已开始 AI 识别')
  try {
    const result = await runAiIdentify(bridge, props.scope)
    if (result.error) toast.warning(aiDoneText(result))
    else toast.success(aiDoneText(result))
    emit('done')
  } catch (error) {
    toast.error(errorText(error))
  } finally {
    running.value = false
  }
}
</script>
