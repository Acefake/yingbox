<template>
  <div
    class="ui-poster-grid ui-skeleton"
    :class="{ 'is-landscape': landscape }"
    role="status"
    aria-busy="true"
  >
    <span class="ui-sr-only">{{ label }}</span>
    <div
      v-for="i in count"
      :key="i"
      class="ui-skeleton__card"
      aria-hidden="true"
    >
      <div class="ui-skeleton__media" />
      <div class="ui-skeleton__line" />
      <div class="ui-skeleton__line is-short" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 海报网格的首屏骨架：首屏等内容时用（分工见 feedback.ts）。
 * 用的就是 .ui-poster-grid，列数、间距、海报比例都与真网格（UiPosterCard）一致，内容到达时不跳。
 * 呼吸动效走 --duration-pulse；系统开了「减少动态效果」时静止。
 */
withDefaults(
  defineProps<{
    /** 占位格数，按首屏大概能看到的数量给 */
    count?: number
    /** 横版（16:9），默认竖版海报（2:3） */
    landscape?: boolean
    /** 读屏文字 */
    label?: string
  }>(),
  { count: 12, landscape: false, label: '正在加载' }
)
</script>

<style>
.ui-skeleton__card {
  animation: ui-skeleton-pulse var(--duration-pulse) ease-in-out infinite;
}
.ui-skeleton__media {
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-lg);
  background: var(--bg-fill-secondary);
}
:where(.ui-skeleton.is-landscape) .ui-skeleton__media {
  aspect-ratio: 16 / 9;
}
.ui-skeleton__line {
  width: 80%;
  height: var(--space-3);
  margin-top: var(--space-3);
  border-radius: var(--radius-xs);
  background: var(--bg-fill-secondary);
}
.ui-skeleton__line:where(.is-short) {
  width: 45%;
  margin-top: var(--space-2);
}
@keyframes ui-skeleton-pulse {
  50% {
    opacity: 0.5;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ui-skeleton__card {
    animation: none;
  }
}
</style>
