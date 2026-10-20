<template>
  <button
    type="button"
    class="ui-list-row"
    :class="{ 'is-selected': selected }"
    :disabled="disabled"
  >
    <span v-if="$slots.leading" class="ui-list-row-leading"
      ><slot name="leading"
    /></span>
    <span class="ui-list-row-body">
      <span class="ui-list-row-title"><slot /></span>
      <span v-if="$slots.description" class="ui-list-row-description"
        ><slot name="description"
      /></span>
    </span>
    <span v-if="$slots.trailing" class="ui-list-row-trailing"
      ><slot name="trailing"
    /></span>
  </button>
</template>

<script setup lang="ts">
/**
 * 可点的列表行：搜索结果、建议提示卡、菜单项、子任务等多行文字目标。
 *
 * 文字左对齐、可换行；悬停浅底，selected 为中性 --bg-active。
 * selected 只管外观，语义由调用方通过属性透传给原生 button，例如
 * role="menuitemradio" + aria-checked，或 aria-current="page"。
 *
 * 插槽：leading 前置图标；默认插槽为标题；description 次要说明（小字、弱化）；
 * trailing 尾部图标或数值。
 *
 * 样式的状态选择器都包在 :where() 里，页面用一个 class 就能覆盖内边距和颜色。
 */
defineProps<{
  selected?: boolean
  disabled?: boolean
}>()
</script>

<style>
.ui-list-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  text-align: left;
  cursor: pointer;
  transition: var(--transition-fast);
}
.ui-list-row-leading,
.ui-list-row-trailing {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  color: var(--text-tertiary);
}
.ui-list-row-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ui-list-row-title {
  min-width: 0;
  overflow-wrap: anywhere;
}
.ui-list-row-description {
  min-width: 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}
.ui-list-row:where(:hover:not(:disabled)) {
  background: var(--bg-glass-hover);
}
.ui-list-row:where(.is-selected) {
  background: var(--bg-active);
  font-weight: var(--font-weight-medium);
}
.ui-list-row:where(.is-selected) .ui-list-row-trailing {
  color: var(--text-primary);
}
.ui-list-row:where(:focus-visible) {
  outline: none;
  box-shadow: var(--focus-ring);
}
.ui-list-row:where(:disabled) {
  opacity: 0.5;
  cursor: default;
}
</style>
