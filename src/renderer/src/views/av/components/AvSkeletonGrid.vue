<template>
  <div class="ui-poster-grid is-landscape" aria-hidden="true">
    <div v-for="i in count" :key="i" class="av-skeleton">
      <div class="av-skeleton-media" />
      <div class="av-skeleton-line" />
      <div class="av-skeleton-line is-short" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 横版海报网格的加载占位，尺寸与 UiPosterCard（landscape）一致，
 * 内容到达时不会跳动。
 */
withDefaults(defineProps<{ count?: number }>(), { count: 12 })
</script>

<style scoped>
.av-skeleton {
  animation: av-skeleton-pulse var(--duration-pulse) ease-in-out infinite;
}
.av-skeleton-media {
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-lg);
  background: var(--bg-fill-secondary);
}
.av-skeleton-line {
  width: 80%;
  height: var(--space-3);
  margin-top: var(--space-3);
  border-radius: var(--radius-xs);
  background: var(--bg-fill-secondary);
}
.av-skeleton-line.is-short {
  width: 40%;
  margin-top: var(--space-2);
}
@keyframes av-skeleton-pulse {
  50% {
    opacity: 0.5;
  }
}
</style>
