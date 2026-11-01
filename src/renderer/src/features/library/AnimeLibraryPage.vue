<template>
  <LibraryPage section="anime" />
</template>

<script setup lang="ts">
/**
 * 路由 /anime：动漫（普通片库里按 TMDB 类型归为动漫的动画剧集与动画电影，见 shared/library/category.ts）。
 * 与其他分区各是一个组件，keep-alive 分别缓存，切换时各自保留滚动位置。
 */
import LibraryPage from './LibraryPage.vue'

defineOptions({ name: 'AnimeLibraryPage' })
</script>
