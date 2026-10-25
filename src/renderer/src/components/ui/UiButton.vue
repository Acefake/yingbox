<template>
  <button
    type="button"
    class="ui-button"
    :class="[
      `is-${variant}`,
      `is-${size}`,
      {
        'yb-glass': variant === 'glass',
        'is-loading': loading,
        'is-pressed': pressed,
      },
    ]"
    :disabled="disabled"
    :aria-pressed="pressed === undefined ? undefined : pressed"
    :aria-busy="loading || undefined"
    :aria-disabled="loading || undefined"
    @click="blockBusyClick(loading, $event)"
  >
    <UiIcon
      v-if="icon || loading"
      :name="loading ? 'refresh' : icon!"
      :size="size === 'lg' ? 'lg' : 'sm'"
    />
    <span
      ><slot>{{ label }}</slot></span
    >
  </button>
</template>

<script setup lang="ts">
/**
 * 带文字的按钮（可带前置图标），胶囊形。高度三档取控件高度令牌：sm 28 / md 36 / lg 44。
 *
 * variant：
 * - primary：白色实心，一个区域里最多一个（例如详情页的「播放」）
 * - secondary：灰色实色底，页头工具条与普通操作的默认样式
 * - glass：玻璃底（.yb-glass），浮在画面或浮层上
 * - plain：透明底、强调色字，行内的轻操作
 * - danger：只给破坏性操作的确认（如确认框里的「删除」）
 *
 * pressed：开关按钮（如「追更」面板开关）；传了就输出 aria-pressed，按下时反色。
 * 只有图标、没有文字的按钮用 UiIconButton。
 * loading：转圈 + aria-busy / aria-disabled，按钮保持可聚焦（不加 disabled），点击被拦下（见 feedback.ts）。
 */
import { blockBusyClick } from './feedback'
import type { IconName } from './icons'
import UiIcon from './UiIcon.vue'

withDefaults(
  defineProps<{
    label?: string
    icon?: IconName
    variant?: 'primary' | 'secondary' | 'glass' | 'plain' | 'danger'
    size?: 'sm' | 'md' | 'lg'
    disabled?: boolean
    loading?: boolean
    /** 开关按钮的按下状态；不传表示普通按钮 */
    pressed?: boolean
  }>(),
  { variant: 'secondary', size: 'md', pressed: undefined }
)
</script>

<style>
.ui-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: var(--control-height);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-full);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: var(--transition-fast);
}
.ui-button.is-sm {
  height: var(--control-height-sm);
  padding: 0 var(--space-3);
  font-size: var(--text-xs);
}
.ui-button.is-lg {
  height: var(--control-height-lg);
  padding: 0 var(--space-6);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}
.ui-button.is-primary {
  background: var(--action-bg);
  color: var(--action-text);
}
.ui-button.is-primary:hover:not(:disabled) {
  background: var(--action-hover);
}
.ui-button.is-secondary {
  background: var(--bg-fill-secondary);
  color: var(--text-primary);
}
.ui-button.is-secondary:hover:not(:disabled) {
  background: color-mix(
    in srgb,
    var(--bg-fill-secondary) 84%,
    var(--text-primary)
  );
}
/* 玻璃：模糊与阴影来自 .yb-glass，底色在双类里显式写（压过基类） */
.ui-button.is-glass {
  background: var(--glass-bg);
  color: var(--text-primary);
}
.ui-button.is-glass:hover:not(:disabled) {
  background: var(--glass-bg-hover);
}
/* 开关按下：反色（白底黑字），与选中的筛选胶囊一致 */
.ui-button.is-pressed,
.ui-button.is-pressed:hover:not(:disabled) {
  background: var(--text-primary);
  color: var(--bg-content);
}
.ui-button.is-danger {
  background: var(--danger);
  color: var(--text-on-accent);
}
.ui-button.is-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 88%, var(--text-primary));
}
.ui-button.is-danger:focus-visible {
  box-shadow: var(--focus-ring-danger);
}
.ui-button.is-plain {
  background: transparent;
  color: var(--accent-text);
}
.ui-button.is-plain:hover:not(:disabled) {
  background: var(--accent-soft);
}
.ui-button:active:not(:disabled, .is-loading) {
  transform: scale(0.97);
}
.ui-button:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.ui-button:disabled {
  opacity: 0.4;
  cursor: default;
}
.ui-button.is-loading {
  cursor: progress;
}
.ui-button.is-loading .app-icon {
  animation: yb-icon-spin var(--duration-spin) linear infinite;
}
</style>
