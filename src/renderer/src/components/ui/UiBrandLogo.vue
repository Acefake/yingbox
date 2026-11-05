<script setup lang="ts">
/** 玻璃品牌标志；配色由设备设置传入，入场扫光一次。 */
import { computed } from 'vue'
import type { BrandColor } from '../../../../shared/brand'
import { brandIcon } from './brand'

const props = withDefaults(
  defineProps<{
    /** 当前配色，默认紫水晶。 */
    color?: BrandColor
  }>(),
  { color: 'purple' }
)
const logo = computed(() => brandIcon(props.color))
</script>

<template>
  <span
    :key="color"
    class="ui-brand-logo"
    :style="{ maskImage: `url(${logo})` }"
    aria-hidden="true"
  >
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
