<template>
  <LibraryPage section="documentary" />
</template>

<script setup lang="ts">
/**
 * 路由 /documentary：纪录片（普通片库里按 TMDB 类型归为纪录片的电影与剧集，见 shared/library/category.ts）。
 * 与其他分区各是一个组件，keep-alive 分别缓存，切换时各自保留滚动位置。
 */
import LibraryPage from './LibraryPage.vue'

defineOptions({ name: 'DocumentaryLibraryPage' })
</script>
