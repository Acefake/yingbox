<template>
  <div class="agent-approvals">
    <strong>以下操作需要你确认</strong>
    <div
      v-for="interrupt in interrupts"
      :key="interrupt.id"
      class="agent-approval"
    >
      <details>
        <summary>
          {{ interrupt.reason || interrupt.toolCallId || '待确认操作' }}
        </summary>
        <pre>{{ cellText(interrupt.value ?? interrupt) }}</pre>
      </details>
      <UiButton
        size="sm"
        icon="check"
        label="批准"
        :disabled="disabled"
        :aria-pressed="decisions[interrupt.id] === true"
        @click="emit('decide', interrupt.id, true)"
      />
      <UiButton
        size="sm"
        icon="close"
        label="拒绝"
        :disabled="disabled"
        :aria-pressed="decisions[interrupt.id] === false"
        @click="emit('decide', interrupt.id, false)"
      />
    </div>
    <UiButton
      variant="primary"
      label="提交决定并继续"
      :disabled="disabled || !complete"
      @click="emit('submit')"
    />
  </div>
</template>

<script setup lang="ts">
/** 待审批的工具调用：逐项批准 / 拒绝，全部决定后提交并继续回合。 */
import { UiButton } from '@/components/ui'
import type { AgentInterrupt } from '../../api/amane-agent'
import { cellText } from '../../utils/agent'

defineProps<{
  interrupts: AgentInterrupt[]
  decisions: Record<string, boolean>
  /** 忙或回合进行中时禁用 */
  disabled: boolean
  /** 是否每项都已决定 */
  complete: boolean
}>()
const emit = defineEmits<{
  decide: [id: string, approved: boolean]
  submit: []
}>()
</script>
