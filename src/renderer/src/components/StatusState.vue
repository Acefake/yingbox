<template>
  <div class="av-status" :class="`is-${tone}`" role="status">
    <UiIcon v-if="icon" :name="icon" size="lg" class="av-status-icon" />
    <p class="av-status-title">{{ title }}</p>
    <p v-if="hint" class="av-status-hint">{{ hint }}</p>
    <div v-if="$slots.default" class="av-status-actions"><slot /></div>
  </div>
</template>

<script setup lang="ts">
/**
 * 空状态 / 错误状态的统一占位：一行说明、可选提示和操作（默认插槽）。
 */
import type { IconName } from '@/components/ui/icons'
import UiIcon from '@/components/ui/UiIcon.vue'

withDefaults(
  defineProps<{
    title: string
    hint?: string
    icon?: IconName
    tone?: 'muted' | 'danger'
  }>(),
  { tone: 'muted' }
)
</script>

<style scoped>
.av-status {
  display: flex;
  min-height: 240px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  text-align: center;
  color: var(--text-tertiary);
}
.av-status-icon {
  margin-bottom: var(--space-2);
  color: var(--text-quaternary);
}
.av-status-title {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.av-status.is-danger .av-status-title {
  color: var(--danger);
}
.av-status-hint {
  margin: 0;
  font-size: var(--text-xs);
}
.av-status-actions {
  margin-top: var(--space-2);
}
</style>
