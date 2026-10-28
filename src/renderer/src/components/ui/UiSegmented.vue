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
      <span v-if="option.count != null" class="ui-segmented-count">{{
        option.count
      }}</span>
    </button>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
/**
 * 分段控件：页面内切换视图（Tab）的唯一样式。胶囊形，外框高度取控件高度令牌（md 36 / sm 28），
 * 与同一行的 UiButton、筛选胶囊 UiChip 对齐。
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
  /** 标签后的数量，比标签淡一档 */
  count?: number | string
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
  flex: none;
  padding: var(--space-0_5);
  border-radius: var(--radius-full);
  background: var(--bg-fill-tertiary);
}
.ui-segmented-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-width: 32px;
  height: calc(var(--control-height) - 4px);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-full);
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
  padding: 0 var(--space-3);
  font-size: var(--text-xs);
}
.ui-segmented-count {
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  font-variant-numeric: tabular-nums;
}
.ui-segmented-item:hover {
  color: var(--text-primary);
}
.ui-segmented-item.is-active {
  background: var(--control-bg);
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-sm), var(--shadow-control);
}
.ui-segmented-item:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
