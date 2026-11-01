<template>
  <LibraryPage section="variety" />
</template>

<script setup lang="ts">
/**
 * 路由 /variety：综艺（普通片库里按 TMDB 类型归为综艺的真人秀与脱口秀，见 shared/library/category.ts）。
 * 与其他分区各是一个组件，keep-alive 分别缓存，切换时各自保留滚动位置。
 */
import LibraryPage from './LibraryPage.vue'

defineOptions({ name: 'VarietyLibraryPage' })
</script>
