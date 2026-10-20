<template>
  <div
    class="ui-segmented"
    :class="`is-${size}`"
    role="tablist"
    :aria-label="label"
  >
    <button
      v-for="option in options"
      :key="option.value"
      v-tooltip="option.icon && !option.label ? option.title : undefined"
      type="button"
      role="tab"
      class="ui-segmented-item"
      :class="{ 'is-active': option.value === modelValue }"
      :aria-selected="option.value === modelValue"
      :aria-label="option.label || option.title"
      @click="emit('update:modelValue', option.value)"
    >
      <UiIcon v-if="option.icon" :name="option.icon" size="sm" />
      <span v-if="option.label">{{ option.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
/**
 * 分段控件：页面内切换视图（Tab）的唯一样式。
 * 选项只有图标时，title 作为悬停提示和无障碍名称。
 */
import type { IconName } from './icons'
import { vTooltip } from './tooltip'
import UiIcon from './UiIcon.vue'

export interface SegmentedOption<V extends string = string> {
  value: V
  label?: string
  icon?: IconName
  title?: string
}

withDefaults(
  defineProps<{
    modelValue: T
    options: SegmentedOption<T>[]
    label?: string
    size?: 'sm' | 'md'
  }>(),
  { size: 'md' }
)

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<style>
.ui-segmented {
  display: inline-flex;
  gap: var(--space-0_5);
  padding: var(--space-0_5);
  border-radius: var(--radius-md);
  background: var(--bg-glass);
}
.ui-segmented-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-width: 32px;
  height: calc(var(--control-height) - 4px);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  white-space: nowrap;
  cursor: pointer;
  transition: var(--transition-fast);
}
.ui-segmented.is-sm .ui-segmented-item {
  height: calc(var(--control-height-sm) - 4px);
  font-size: var(--text-xs);
}
.ui-segmented-item:hover {
  color: var(--text-primary);
}
.ui-segmented-item.is-active {
  background: var(--bg-fill-secondary);
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-sm);
}
[data-theme='light'] .ui-segmented-item.is-active {
  background: #fff;
}
.ui-segmented-item:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
