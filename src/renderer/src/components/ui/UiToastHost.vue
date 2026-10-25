<template>
  <TransitionGroup tag="div" name="ui-toast" class="ui-toast-stack">
    <div
      v-for="item in items"
      :key="item.id"
      class="ui-toast yb-glass"
      :class="`is-${item.kind}`"
      :role="item.kind === 'error' ? 'alert' : 'status'"
      :aria-live="item.kind === 'error' ? 'assertive' : 'polite'"
    >
      <span
        v-if="item.kind === 'loading'"
        class="ui-toast__spinner"
        aria-hidden="true"
      />
      <UiIcon
        v-else
        class="ui-toast__icon"
        :name="ICONS[item.kind]"
        size="sm"
      />
      <span class="ui-toast__text">{{ item.text }}</span>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
/**
 * toast 的宿主：由 toast.ts 在第一次提示时挂到 body，页面里不要直接使用。
 * 只负责把队列画出来，增删和计时都在 toast.ts。
 */
import type { IconName } from './icons'
import type { ToastItem, ToastKind } from './toast'
import UiIcon from './UiIcon.vue'

defineProps<{ items: readonly Readonly<ToastItem>[] }>()

const ICONS: Record<Exclude<ToastKind, 'loading'>, IconName> = {
  success: 'check',
  error: 'warning',
  warning: 'warning',
  info: 'info',
}
</script>

<style>
/* 宿主是 manual popover：去掉浏览器给 [popover] 的默认边框、底色和居中 */
.ui-toast-layer {
  position: fixed;
  inset: var(--space-4) 0 auto;
  width: auto;
  height: auto;
  margin: 0;
  padding: 0;
  overflow: visible;
  border: 0;
  background: transparent;
  pointer-events: none;
}
.ui-toast-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}
.ui-toast {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: min(480px, calc(100vw - var(--space-8)));
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}
.ui-toast__text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.ui-toast.is-success .ui-toast__icon {
  color: var(--success);
}
.ui-toast.is-error .ui-toast__icon {
  color: var(--danger);
}
.ui-toast.is-warning .ui-toast__icon {
  color: var(--warning);
}
.ui-toast.is-info .ui-toast__icon {
  color: var(--text-secondary);
}
.ui-toast__spinner {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border: 2px solid var(--separator);
  border-top-color: var(--text-secondary);
  border-radius: 50%;
  animation: yb-icon-spin var(--duration-spin) linear infinite;
}

/* 进出：轻微下落 + 淡入，离开时淡出上移；其余条目平滑补位 */
.ui-toast-enter-active,
.ui-toast-leave-active,
.ui-toast-move {
  transition:
    opacity var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out);
}
.ui-toast-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
.ui-toast-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.ui-toast-leave-active {
  position: absolute;
}
@media (prefers-reduced-motion: reduce) {
  .ui-toast-enter-active,
  .ui-toast-leave-active,
  .ui-toast-move {
    transition: opacity var(--duration-fast) ease;
  }
  .ui-toast-enter-from,
  .ui-toast-leave-to {
    transform: none;
  }
}
</style>
