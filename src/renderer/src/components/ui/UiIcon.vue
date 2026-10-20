<template>
  <svg
    class="app-icon"
    :class="[sizeClass, { 'is-filled': filled }]"
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    aria-hidden="true"
  >
    <path v-if="paths[name]" :d="paths[name]" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { type IconName, ICON_PATHS as paths } from './icons'

const props = withDefaults(
  defineProps<{
    name: IconName
    size?: 'sm' | 'md' | 'lg'
    filled?: boolean
  }>(),
  { size: 'md', filled: false }
)

const sizeClass = computed(() => `app-icon--${props.size}`)
</script>

<style scoped>
.app-icon {
  display: block;
  flex: 0 0 auto;
  box-sizing: content-box;
  fill: none;
  stroke: currentColor;
  stroke-width: var(--icon-stroke, 1.75);
  stroke-linecap: round;
  stroke-linejoin: round;
  overflow: visible;
  vertical-align: middle;
  /* optical box keeps glyphs centered next to text */
  margin-block: 0;
}

.app-icon.is-filled {
  fill: currentColor;
}

.app-icon--sm {
  width: var(--icon-sm, 14px);
  height: var(--icon-sm, 14px);
}

.app-icon--md {
  width: var(--icon-md, 16px);
  height: var(--icon-md, 16px);
}

.app-icon--lg {
  width: var(--icon-lg, 18px);
  height: var(--icon-lg, 18px);
}
</style>
