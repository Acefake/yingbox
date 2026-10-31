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
 * 分段控件：页面内切换视图（Tab）的唯一样式。长相与页面级筛选胶囊（UiChip size="md"）一致：
 * 一枚枚独立的实色胶囊，选中反色；高度取控件高度令牌（md 36 / sm 28），与同一行的 UiButton 对齐。
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
/* 和页面级筛选胶囊（UiChip size="md"）同一套长相：一枚枚独立的实色胶囊，选中反色（白底黑字） */
.ui-segmented {
  display: inline-flex;
  flex: none;
  gap: var(--space-2);
}
.ui-segmented-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1_5);
  min-width: 32px;
  height: var(--control-height);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-full);
  background: var(--bg-card);
  box-shadow: var(--shadow-control);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: var(--transition-fast);
}
.ui-segmented:where(.is-sm) .ui-segmented-item {
  gap: var(--space-1);
  height: var(--control-height-sm);
  padding: 0 var(--space-3);
  font-size: var(--text-xs);
}
.ui-segmented-count {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  font-weight: var(--font-weight-medium);
}
.ui-segmented-item:where(:hover:not(.is-active)) {
  background: var(--control-bg-hover);
}
.ui-segmented-item:where(.is-active) {
  background: var(--text-primary);
  color: var(--bg-elevated);
  box-shadow: none;
  font-weight: var(--font-weight-semibold);
}
.ui-segmented-item:where(.is-active) .ui-segmented-count {
  color: inherit;
  opacity: 0.6;
}
.ui-segmented-item:where(:focus-visible) {
  outline: none;
  box-shadow: var(--focus-ring);
}
</style>
