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
 * - size="lg"：页面级筛选胶囊（片库、直播分组），34px 高、卡片实色底，选中时反色（白底黑字）。
 *
 * 插槽：leading 前置图标或符号；默认插槽覆盖 label。
 */
withDefaults(
  defineProps<{
    label?: string
    selected?: boolean
    disabled?: boolean
    /** sm：行内小胶囊；lg：页面筛选胶囊 */
    size?: 'sm' | 'lg'
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
.ui-chip:where(.is-lg) {
  flex: none;
  gap: var(--space-1_5);
  min-height: 34px;
  padding: 0 var(--space-3_5);
  background: var(--bg-fill-tertiary);
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}
.ui-chip:where(.is-lg:hover:not(:disabled)) {
  background: var(--bg-fill-secondary);
}
.ui-chip:where(.is-lg.is-selected) {
  background: var(--text-primary);
  color: var(--bg-content);
  font-weight: var(--font-weight-semibold);
}
.ui-chip:where(:focus-visible) {
  outline: none;
  box-shadow: var(--focus-ring);
}
.ui-chip:where(:disabled) {
  cursor: default;
}
</style>
