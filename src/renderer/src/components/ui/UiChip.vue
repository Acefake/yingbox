<template>
  <button
    type="button"
    class="ui-chip"
    :class="[`is-${size}`, { 'is-selected': selected }]"
    :aria-pressed="selected === undefined ? undefined : selected"
    :disabled="disabled"
  >
    <slot name="leading" />
    <slot>{{ label }}</slot>
    <span v-if="count !== undefined" class="ui-chip-count">{{ count }}</span>
  </button>
</template>

<script setup lang="ts">
/**
 * 小胶囊：演员、标签等可点的短文本，中性灰底。
 *
 * - selected 传了就输出 aria-pressed（筛选开关）；不传表示普通链接式芯片。
 * - disabled 时外观不变灰，只是不可点：芯片同时承担展示作用（如没有档案的演员名）。
 * - 不提供内嵌删除按钮（button 里不能再嵌按钮）；需要删除时，
 *   在芯片旁边放一个 UiIconButton icon="close"。
 *
 * - size="md"：页面级筛选胶囊（片库匹配状态、直播分组），高度取 --control-height（36），
 *   玻璃底，选中时提亮；和 UiSegmented、UiButton 排在同一行时等高。
 * - count：文字后面的数量（如「待确认 691」），比文字淡一档。
 *
 * 插槽：leading 前置图标或符号；默认插槽覆盖 label。
 */
withDefaults(
  defineProps<{
    label?: string
    selected?: boolean
    disabled?: boolean
    /** sm：行内小胶囊；md：页面筛选胶囊 */
    size?: 'sm' | 'md'
    /** 数量，显示在文字后面 */
    count?: number | string
  }>(),
  { selected: undefined, size: 'sm' }
)
</script>

<style>
.ui-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  min-height: 24px;
  padding: var(--space-1) var(--space-2);
  border: 0;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-xs);
  line-height: var(--leading-tight);
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition: var(--transition-fast);
}
.ui-chip:where(:hover:not(:disabled)) {
  background: var(--bg-active);
}
.ui-chip:where(.is-selected) {
  background: var(--bg-active);
  font-weight: var(--font-weight-medium);
}
.ui-chip:where(.is-md) {
  flex: none;
  gap: var(--space-1_5);
  min-height: var(--control-height);
  padding: 0 var(--space-4);
  background: var(--glass-bg);
  color: var(--text-primary);
  box-shadow: inset 0 0 0 0.5px var(--border-glass-light);
  -webkit-backdrop-filter: var(--glass-filter);
  backdrop-filter: var(--glass-filter);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}
.ui-chip:where(.is-md:hover:not(:disabled)) {
  background: var(--glass-bg-hover);
}
.ui-chip:where(.is-md.is-selected) {
  background: color-mix(in srgb, var(--glass-bg) 75%, var(--text-primary));
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
}
.ui-chip-count {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  font-weight: var(--font-weight-medium);
}
.ui-chip:where(.is-selected) .ui-chip-count {
  color: inherit;
  opacity: 0.6;
}
.ui-chip:where(:focus-visible) {
  outline: none;
  box-shadow: var(--focus-ring);
}
.ui-chip:where(:disabled) {
  cursor: default;
}
</style>
