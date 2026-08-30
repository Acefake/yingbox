<template>
  <svg class="app-icon" :class="sizeClass" viewBox="0 0 24 24" aria-hidden="true">
    <path v-if="paths[name]" :d="paths[name]" />
  </svg>
</template>

<script setup lang="ts">
const paths = {
  home: 'M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-9ZM8 21v-6h8v6',
  history: 'M12 7v5l3 2M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5',
  heart: 'M20.8 8.8c0 5.2-8.8 10.2-8.8 10.2S3.2 14 3.2 8.8A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 8.8 2.7Z',
  movie: 'M4 5h16v14H4zM8 5v4m4-4v4m4-4v4M8 15v4m4-4v4m4-4v4',
  tv: 'M4 6h16v12H4zM8 3l4 3 4-3',
  av: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  back: 'm15 18-6-6 6-6',
  forward: 'm9 18 6-6-6-6',
  refresh: 'M20 11a8 8 0 1 0 2 5.3M20 5v6h-6',
  search: 'm20 20-4-4m-5-1a7 7 0 1 1 0-14 7 7 0 0 1 0 14',
  database: 'M4 5c0 1.7 3.6 3 8 3s8-1.3 8-3-3.6-3-8-3-8 1.3-8 3Zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5m-16 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
} as const
const props = defineProps<{ name: keyof typeof paths; size?: 'sm' | 'md' }>()
const sizeClass = props.size === 'sm' ? 'app-icon-sm' : 'app-icon-md'
</script>

<style scoped>
.app-icon { display:block; flex:0 0 auto; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.app-icon-md { width:16px; height:16px; }
.app-icon-sm { width:14px; height:14px; }
</style>
