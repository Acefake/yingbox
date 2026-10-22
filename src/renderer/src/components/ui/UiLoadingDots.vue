<template>
  <span class="ui-loading-dots" role="status">
    <span class="ui-loading-dots__dots" aria-hidden="true">
      <span v-for="i in 3" :key="i" class="ui-loading-dots__dot" />
    </span>
    <span v-if="label">{{ label }}</span>
    <span v-else class="ui-sr-only">正在加载</span>
  </span>
</template>

<script setup lang="ts">
/**
 * 后台进行中的轻提示（三个依次呼吸的点 + 可选文字），不挡操作（分工见 feedback.ts）。
 * 放在内容后面或标题旁，出现 / 消失不推动正在读的内容。减少动态效果时三点静止。
 */
defineProps<{
  /** 可见文字，如「仍在搜索其他源」；不给时只有读屏文字 */
  label?: string
}>()
</script>

<style>
.ui-loading-dots {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.ui-loading-dots__dots {
  display: inline-flex;
  gap: var(--space-1);
}
.ui-loading-dots__dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-full);
  background: currentColor;
  animation: ui-loading-dots var(--duration-pulse) ease-in-out infinite;
}
.ui-loading-dots__dot:nth-child(2) {
  animation-delay: calc(var(--duration-pulse) / 6);
}
.ui-loading-dots__dot:nth-child(3) {
  animation-delay: calc(var(--duration-pulse) / 3);
}
@keyframes ui-loading-dots {
  0%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ui-loading-dots__dot {
    animation: none;
    opacity: 0.6;
  }
}
</style>
