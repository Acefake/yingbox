<template>
  <button
    v-tooltip="label"
    type="button"
    class="yb-icon-button"
    :class="[
      `is-${variant}`,
      `is-${size}`,
      { 'yb-glass is-media': variant === 'overlay' },
      { 'is-active': active, 'is-danger': danger, 'is-loading': loading },
    ]"
    :aria-label="label"
    :aria-pressed="active === undefined ? undefined : active"
    :aria-busy="loading || undefined"
    :aria-disabled="loading || undefined"
    :disabled="disabled"
    @click="blockBusyClick(loading, $event)"
  >
    <UiIcon
      :name="loading ? 'refresh' : icon"
      :size="size === 'lg' ? 'lg' : 'md'"
      :filled="filled"
    />
  </button>
</template>

<script setup lang="ts">
/**
 * 只有图标的按钮。label 必填：作为无障碍名称，同时是悬停提示。
 *
 * variant：
 * - plain：透明底，工具栏默认
 * - secondary：浅填充底，和文字按钮并排时用
 * - overlay：深色玻璃圆钮（.yb-glass is-media），叠在海报和图片上
 *
 * loading：图标转圈 + aria-busy / aria-disabled，保持可聚焦（不加 disabled），点击被拦下（见 feedback.ts）。
 */
import { blockBusyClick } from './feedback'
import type { IconName } from './icons'
import { vTooltip } from './tooltip'
import UiIcon from './UiIcon.vue'

withDefaults(
  defineProps<{
    icon: IconName
    label: string
    variant?: 'plain' | 'secondary' | 'overlay'
    size?: 'sm' | 'md' | 'lg'
    disabled?: boolean
    loading?: boolean
    active?: boolean
    danger?: boolean
    filled?: boolean
  }>(),
  { variant: 'plain', size: 'md', active: undefined }
)
</script>

<style>
.yb-icon-button {
  --ib-size: var(--control-height);
  display: inline-flex;
  flex: 0 0 var(--ib-size);
  align-items: center;
  justify-content: center;
  width: var(--ib-size);
  height: var(--ib-size);
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: var(--transition-fast);
}
.yb-icon-button.is-sm {
  --ib-size: var(--control-height-sm);
}
.yb-icon-button.is-lg {
  --ib-size: var(--control-height-lg);
  border-radius: var(--radius-full);
}
.yb-icon-button.is-secondary {
  background: var(--bg-glass);
  color: var(--text-primary);
}
.yb-icon-button.is-overlay {
  border-radius: var(--radius-full);
}
.yb-icon-button:hover:not(:disabled) {
  background: var(--bg-glass-hover);
  color: var(--text-primary);
}
.yb-icon-button.is-overlay:hover:not(:disabled) {
  background: var(--glass-media-bg-hover);
  color: var(--media-text);
}
.yb-icon-button:active:not(:disabled, .is-loading) {
  transform: scale(0.94);
}
.yb-icon-button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.yb-icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}
.yb-icon-button.is-active {
  background: var(--bg-active);
  color: var(--text-primary);
}
.yb-icon-button.is-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}
.yb-icon-button.is-loading {
  cursor: progress;
}
.yb-icon-button.is-loading .app-icon {
  animation: yb-icon-spin var(--duration-spin) linear infinite;
}
@keyframes yb-icon-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
