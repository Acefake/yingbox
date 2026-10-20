<template>
  <button
    type="button"
    class="ui-pressable"
    :class="{ 'is-block': block }"
    :aria-label="label"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
/**
 * 无样式的可点区域：剧照、演员卡、悬停卡大图和标题这类图片或卡片目标。
 *
 * 只清掉原生按钮的外观，保留焦点环和轻微按压反馈（缩放 0.98，减少动态效果时关闭）。
 * 外观（尺寸、底色、圆角、悬停）全部交给页面 class。
 *
 * - block：display:block 撑满一行；默认 inline-block。页面 class 可再改成 grid / flex。
 * - label：内容里没有文字（只有图片）时必须传，作为无障碍名称；有文字时不要传。
 */
defineProps<{
  label?: string
  block?: boolean
  disabled?: boolean
}>()
</script>

<style>
.ui-pressable {
  display: inline-block;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: inherit;
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out);
}
.ui-pressable:where(.is-block) {
  display: block;
  width: 100%;
}
.ui-pressable:where(:active:not(:disabled)) {
  transform: scale(0.98);
}
.ui-pressable:where(:focus-visible) {
  outline: none;
  box-shadow: var(--focus-ring);
}
.ui-pressable:where(:disabled) {
  cursor: default;
}
@media (prefers-reduced-motion: reduce) {
  .ui-pressable:where(:active:not(:disabled)) {
    transform: none;
  }
}
</style>
