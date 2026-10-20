<template>
  <button
    v-tooltip="collapsed ? label : undefined"
    type="button"
    class="ui-nav-item"
    :class="[
      `is-${layout}`,
      { 'is-active': active, 'is-collapsed': collapsed },
    ]"
    :aria-label="label"
    :aria-current="current === 'page' && active ? 'page' : undefined"
    :aria-pressed="current === 'pressed' ? !!active : undefined"
    :disabled="disabled"
  >
    <slot name="icon">
      <UiIcon v-if="icon" :name="icon" :size="iconSize" />
    </slot>
    <span class="ui-nav-item-label"
      ><slot>{{ label }}</slot></span
    >
    <slot name="trailing" />
    <slot name="extra" />
  </button>
</template>

<script setup lang="ts">
/**
 * 导航项：侧栏、设置分区、二级分组导航、手机底部标签栏的唯一样式。
 *
 * - label 必填：同时作为无障碍名称；collapsed 时文字隐藏，改为悬停提示。
 *   可见文字和无障碍名称不同时（如「刮削队列」/「打开刮削队列」），
 *   label 写完整名称，默认插槽放可见文字。
 * - current：'page' 表示切换页面/分区，选中时 aria-current="page"；
 *   'pressed' 表示开关浮层，始终输出 aria-pressed；
 *   'none' 都不输出（例如打开抽屉的「菜单」，由调用方加 aria-expanded）。
 * - layout：'row' 图标 + 文字横排；'stack' 图标在上、小字在下（手机底部标签栏）。
 *
 * 插槽：icon 自定义前置图标（如带脉冲点的队列图标）；默认插槽覆盖文字；
 * trailing 尾部角标或未保存圆点；extra 绝对定位的附加层（如进度条）。
 *
 * 样式的状态选择器都包在 :where() 里，页面用一个 class 就能覆盖尺寸和颜色。
 */
import type { IconName } from './icons'
import { vTooltip } from './tooltip'
import UiIcon from './UiIcon.vue'

withDefaults(
  defineProps<{
    label: string
    icon?: IconName
    iconSize?: 'sm' | 'md' | 'lg'
    active?: boolean
    collapsed?: boolean
    current?: 'page' | 'pressed' | 'none'
    layout?: 'row' | 'stack'
    disabled?: boolean
  }>(),
  { iconSize: 'md', current: 'page', layout: 'row' }
)
</script>

<style>
.ui-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
  height: var(--control-height);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition: var(--transition-fast);
}
.ui-nav-item .app-icon {
  color: var(--text-secondary);
}
.ui-nav-item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ui-nav-item:where(:hover:not(:disabled)) {
  background: var(--bg-glass-hover);
}
.ui-nav-item:where(.is-active) {
  background: var(--bg-active);
  font-weight: var(--font-weight-medium);
}
.ui-nav-item:where(.is-active) .app-icon {
  color: var(--text-primary);
}
.ui-nav-item:where(:focus-visible) {
  outline: none;
  box-shadow: var(--focus-ring);
}
.ui-nav-item:where(:disabled) {
  opacity: 0.4;
  cursor: default;
}

/* 收起：只留图标居中 */
.ui-nav-item:where(.is-collapsed) {
  justify-content: center;
  padding: 0;
}
.ui-nav-item:where(.is-collapsed) .ui-nav-item-label {
  display: none;
}

/* 底部标签栏：图标在上、小字在下，选中只提亮文字不加底色 */
.ui-nav-item:where(.is-stack) {
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  height: auto;
  padding: var(--space-1) 0;
  border-radius: 0;
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
  text-align: center;
}
.ui-nav-item:where(.is-stack) .app-icon {
  color: inherit;
}
.ui-nav-item:where(.is-stack:hover:not(:disabled)) {
  background: transparent;
  color: var(--text-secondary);
}
.ui-nav-item:where(.is-stack.is-active) {
  background: transparent;
  color: var(--text-primary);
}
.ui-nav-item:where(.is-stack:focus-visible) {
  box-shadow: inset var(--focus-ring);
}
</style>
