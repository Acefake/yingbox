<template>
  <LibraryPage section="movie" />
</template>

<script setup lang="ts">
/**
 * 路由 /movie：电影库（只含 TMDB 来源的库，番号库在 /jav）。
 * 与剧集、番号各是一个组件，keep-alive 分别缓存，切换时各自保留滚动位置。
 */
import LibraryPage from './LibraryPage.vue'

defineOptions({ name: 'MovieLibraryPage' })
</script>
