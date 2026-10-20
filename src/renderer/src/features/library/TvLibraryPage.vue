<template>
  <LibraryPage kind="tv" />
</template>

<script setup lang="ts">
/**
 * 路由 /tv：剧集库。与电影库各是一个组件，keep-alive 分别缓存，切换时各自保留滚动位置。
 */
import LibraryPage from './LibraryPage.vue'

defineOptions({ name: 'TvLibraryPage' })
</script>
