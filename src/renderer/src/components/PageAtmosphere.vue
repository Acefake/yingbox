<template>
  <div class="page-atmosphere" aria-hidden="true">
    <img class="page-atmosphere-glow" :src="src" alt="" />
    <div class="page-atmosphere-tint" />
    <img class="page-atmosphere-art" :src="src" alt="" />
  </div>
</template>

<script setup lang="ts">
/** 页面顶部的装饰头图与同色环境光；图片由页面提供，不参与交互。 */
defineProps<{ src: string }>()
</script>

<style scoped>
.page-atmosphere {
  position: fixed;
  z-index: -1;
  top: 0;
  right: 0;
  left: 0;
  height: 640px; /* style-tokens: layout（与片库一致的顶部环境光范围） */
  overflow: hidden;
  pointer-events: none;
  mask-image: var(--ambient-mask);
}
.page-atmosphere-glow,
.page-atmosphere-art {
  position: absolute;
  top: 0;
  right: 0;
  width: 100%;
  object-fit: cover;
  object-position: right top;
}
.page-atmosphere-glow {
  height: 100%;
  filter: blur(90px) saturate(1.7);
  opacity: 0.55;
  mix-blend-mode: screen;
}
.page-atmosphere-tint {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    70% 90% at 18% -10%,
    var(--page-atmosphere-glow),
    transparent 70%
  );
}
.page-atmosphere-art {
  width: min(680px, 65%);
  height: 260px; /* style-tokens: layout（装饰头图高度） */
  object-fit: contain;
  mix-blend-mode: screen;
  mask-image:
    linear-gradient(to right, transparent, black 50%),
    linear-gradient(to bottom, black, transparent);
  mask-composite: intersect;
}
:global([data-theme='light'] .page-atmosphere) {
  opacity: 0.45;
}
:global([data-theme='light'] .page-atmosphere-art),
:global([data-theme='light'] .page-atmosphere-glow) {
  display: none;
}
:global(:root[data-transparency='reduced'] .page-atmosphere-glow) {
  display: none;
}
@media (prefers-reduced-transparency: reduce) {
  .page-atmosphere-glow {
    display: none;
  }
}
</style>
