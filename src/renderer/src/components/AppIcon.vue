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
  externalLink: 'M14 3h7v7M21 3 10 14M10 3H3v18h18v-7',
  panel: 'M3 4h18v16H3ZM9 4v16',
  calendar: 'M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6ZM8 3v4M16 3v4M4 10h16',
  plus: 'M12 4v16M4 12h16',
  folder: 'M3 6h7l2 2h9v14H3Z',
  filter: 'M4 5h16l-6 7v7l-4 2v-9Z',
  sort: 'M8 4v16m-4-4 4 4 4-4M15 5h6M15 10h4M15 15h2',
  grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
  play: 'm8 4 12 8-12 8Z',
  pause: 'M7 4v16M17 4v16',
  stop: 'M5 5h14v14H5Z',
  users: 'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 3a4 4 0 0 1 0 8M22 21v-3a4 4 0 0 0-3-3.87',
  file: 'M5 3h9l5 5v13H5ZM14 3v6h5M8 13h8M8 17h6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  check: 'm4 12 5 5L20 6',
  arrowUp: 'M12 20V4m-6 6 6-6 6 6',
  arrowDown: 'M12 4v16m-6-6 6 6 6-6',
  lock: 'M5 10h14v11H5ZM8 10V6a4 4 0 0 1 8 0v4M12 14v3',
  tag: 'M3 3h8l10 10-8 8L3 11ZM7 7h.01',
  image: 'M3 3h18v18H3ZM3 17l6-7 5 5 3-3 4 5M16 7h.01',
  sparkle: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  info: 'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  warning: 'm12 3 10 18H2ZM12 9v5M12 17h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  volume: 'M3 9h4l5-5v16l-5-5H3ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  subtitle: 'M3 5h18v14H3ZM6 10h4M14 10h4M6 14h6M15 14h3',
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-9.5Z',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2',
  heart:
    'M19.5 12.5c0 4.5-7.5 8.5-7.5 8.5S4.5 17 4.5 12.5A4.5 4.5 0 0 1 12 8.2a4.5 4.5 0 0 1 7.5 4.3Z',
  movie:
    'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11ZM8 5v14M16 5v14M4 9.5h4M16 9.5h4M4 14.5h4M16 14.5h4',
  tv: 'M6 8h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM9 4l3 4 3-4',
  av: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17ZM12 8v4.5l3 1.8',
  back: 'm14.5 18-6-6 6-6',
  forward: 'm9.5 18 6-6-6-6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.6M20 5v6h-6',
  search: 'M21 21l-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z',
  database:
    'M4 6c0 1.66 3.58 3 8 3s8-1.34 8-3-3.58-3-8-3-8 1.34-8 3Zm0 0v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6',
  sun: 'M12 4v2m0 12v2M4 12h2m12 0h2m-2.05-5.95-1.4 1.4M7.45 16.55l-1.4 1.4m0-11.9 1.4 1.4m9.1 9.1 1.4 1.4M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z',
  moon: 'M20 14.5A7.5 7.5 0 1 1 9.5 4 6 6 0 0 0 20 14.5Z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  close: 'M18 6 6 18M6 6l12 12',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.87-2.87l.06-.06a1.65 1.65 0 0 0 .33-1.81 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
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
