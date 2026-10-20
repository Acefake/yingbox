<template>
  <button
    type="button"
    class="ui-button"
    :class="[`is-${variant}`, `is-${size}`, { 'is-loading': loading }]"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <UiIcon
      v-if="icon || loading"
      :name="loading ? 'refresh' : icon!"
      :size="size === 'lg' ? 'lg' : 'sm'"
    />
    <span><slot>{{ label }}</slot></span>
  </button>
</template>

<script setup lang="ts">
/**
 * 带文字的按钮。一个区域里最多一个 primary（例如详情页的「播放」），
 * 其余操作优先用 UiIconButton，只有在图标表达不清时才用带文字的 secondary。
 */
import type { IconName } from './icons'
import UiIcon from './UiIcon.vue'

withDefaults(
  defineProps<{
    label?: string
    icon?: IconName
    variant?: 'primary' | 'secondary' | 'plain'
    size?: 'sm' | 'md' | 'lg'
    disabled?: boolean
    loading?: boolean
  }>(),
  { variant: 'secondary', size: 'md' }
)
</script>

<style>
.ui-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: var(--control-height);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: var(--transition-fast);
}
.ui-button.is-sm {
  height: var(--control-height-sm);
  padding: 0 var(--space-3);
  font-size: var(--text-xs);
}
.ui-button.is-lg {
  height: var(--control-height-lg);
  padding: 0 var(--space-6);
  border-radius: var(--radius-full);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}
.ui-button.is-primary {
  background: var(--action-bg);
  color: var(--action-text);
}
.ui-button.is-primary:hover:not(:disabled) {
  background: var(--action-hover);
}
.ui-button.is-secondary {
  background: var(--bg-glass-hover);
  color: var(--text-primary);
}
.ui-button.is-secondary:hover:not(:disabled) {
  background: var(--bg-active);
}
.ui-button.is-plain {
  background: transparent;
  color: var(--accent-text);
}
.ui-button.is-plain:hover:not(:disabled) {
  background: var(--accent-soft);
}
.ui-button:active:not(:disabled) {
  transform: scale(0.97);
}
.ui-button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.ui-button:disabled {
  opacity: 0.4;
  cursor: default;
}
.ui-button.is-loading .app-icon {
  animation: yb-icon-spin 0.9s linear infinite;
}
</style>
