<template>
  <LibraryPage section="jav" />
</template>

<script setup lang="ts">
/**
 * 路由 /jav：番号库（source=jav 的库）。与电影库共用引擎与数据库，界面上独立成页：
 * 海报墙 / 演员 / 待确认、番号站点与演员资料来源设置都在这里。只在成人模式下可进入。
 */
import LibraryPage from './LibraryPage.vue'

defineOptions({ name: 'JavLibraryPage' })
</script>
