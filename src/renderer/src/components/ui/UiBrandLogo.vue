<script setup lang="ts">
/** 蓝色玻璃品牌标志；入场时高光扫过一次，减少动态效果时保持静止。 */
import logo from '@/assets/imgs/logo.png'
</script>

<template>
  <span class="ui-brand-logo" aria-hidden="true">
    <img :src="logo" alt="" />
    <span class="brand-sheen" />
  </span>
</template>

<style scoped>
.ui-brand-logo {
  display: inline-block;
  position: relative;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  overflow: hidden;
  mask-image: url('@/assets/imgs/logo.png');
  mask-size: 100% 100%;
  animation: brand-float calc(var(--duration-pulse) * 2) ease-in-out;
}
.ui-brand-logo img {
  display: block;
  width: 100%;
  height: 100%;
}
.brand-sheen {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    110deg,
    transparent 35%,
    var(--text-primary) 50%,
    transparent 65%
  );
  opacity: 0;
  transform: translateX(-100%);
  animation: brand-sweep calc(var(--duration-pulse) * 2) ease-in-out;
}
@keyframes brand-float {
  50% {
    transform: translateY(calc(var(--space-0_5) * -1));
  }
}
@keyframes brand-sweep {
  25% {
    opacity: 0.12;
  }
  65%,
  100% {
    opacity: 0;
    transform: translateX(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ui-brand-logo,
  .brand-sheen {
    animation: none !important;
  }
}
</style>
