<template>
  <svg
    class="app-icon"
    :class="sizeClass"
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

/** Lucide-style stroke paths, optically centered in 24×24 */
const paths = {
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-9.5Z',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2',
  heart: 'M19.5 12.5c0 4.5-7.5 8.5-7.5 8.5S4.5 17 4.5 12.5A4.5 4.5 0 0 1 12 8.2a4.5 4.5 0 0 1 7.5 4.3Z',
  movie: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11ZM8 5v14M16 5v14M4 9.5h4M16 9.5h4M4 14.5h4M16 14.5h4',
  tv: 'M6 8h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM9 4l3 4 3-4',
  av: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17ZM12 8v4.5l3 1.8',
  back: 'm14.5 18-6-6 6-6',
  forward: 'm9.5 18 6-6-6-6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.6M20 5v6h-6',
  search: 'M21 21l-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z',
  database: 'M4 6c0 1.66 3.58 3 8 3s8-1.34 8-3-3.58-3-8-3-8 1.34-8 3Zm0 0v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6',
  sun: 'M12 4v2m0 12v2M4 12h2m12 0h2m-2.05-5.95-1.4 1.4M7.45 16.55l-1.4 1.4m0-11.9 1.4 1.4m9.1 9.1 1.4 1.4M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z',
  moon: 'M20 14.5A7.5 7.5 0 1 1 9.5 4 6 6 0 0 0 20 14.5Z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  close: 'M18 6 6 18M6 6l12 12',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15l1.6.9-1.6 2.8-1.6-.9a7.5 7.5 0 0 1-2.4 1.4V21h-3.2v-1.8a7.5 7.5 0 0 1-2.4-1.4l-1.6.9L4.6 15.9l1.6-.9a7.6 7.6 0 0 1 0-2.8l-1.6-.9L6.2 8.4l1.6.9a7.5 7.5 0 0 1 2.4-1.4V6h3.2v1.9a7.5 7.5 0 0 1 2.4 1.4l1.6-.9 1.6 2.8-1.6.9a7.6 7.6 0 0 1 0 2.8Z',
} as const

const props = withDefaults(
  defineProps<{ name: keyof typeof paths; size?: 'sm' | 'md' | 'lg' }>(),
  { size: 'md' }
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