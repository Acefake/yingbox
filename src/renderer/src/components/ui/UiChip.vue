<template>
  <button
    type="button"
    class="ui-chip"
    :class="{ 'is-selected': selected }"
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
 * 插槽：leading 前置图标或符号；默认插槽覆盖 label。
 */
withDefaults(
  defineProps<{
    label?: string
    selected?: boolean
    disabled?: boolean
  }>(),
  { selected: undefined }
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
.ui-chip:where(:focus-visible) {
  outline: none;
  box-shadow: var(--focus-ring);
}
.ui-chip:where(:disabled) {
  cursor: default;
}
</style>
