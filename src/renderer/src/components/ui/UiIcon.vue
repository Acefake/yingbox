<template>
  <svg
    class="app-icon"
    :class="`app-icon--${size}`"
    viewBox="0 0 256 256"
    width="16"
    height="16"
    aria-hidden="true"
  >
    <path :d="d" />
  </svg>
</template>

<script setup lang="ts">
/**
 * 图标：Phosphor 实心路径（icons.ts），256 视框，块级显示保证在按钮里居中。
 * 字重用图标的默认值（icons.ts）；filled 用于切换型图标的选中态（已收藏、已评分），换成 fill 字重。
 */
import { computed } from 'vue'

import { type IconName, iconPath } from './icons'

const props = withDefaults(
  defineProps<{
    name: IconName
    size?: 'sm' | 'md' | 'lg'
    filled?: boolean
  }>(),
  { size: 'md', filled: false }
)

const d = computed(() =>
  iconPath(props.name, props.filled ? 'fill' : undefined)
)
</script>

<style scoped>
.app-icon {
  display: block;
  flex: 0 0 auto;
  fill: currentColor;
}

.app-icon--sm {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.app-icon--md {
  width: var(--icon-md);
  height: var(--icon-md);
}

.app-icon--lg {
  width: var(--icon-lg);
  height: var(--icon-lg);
}
</style>
