<template>
  <LibraryPage kind="movie" />
</template>

<script setup lang="ts">
/**
 * 路由 /movie：电影库。与剧集库各是一个组件，keep-alive 分别缓存，切换时各自保留滚动位置。
 */
import LibraryPage from './LibraryPage.vue'

defineOptions({ name: 'MovieLibraryPage' })
</script>
