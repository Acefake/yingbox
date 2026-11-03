<template>
  <section class="autograb-page">
    <PageAtmosphere :src="autograbHero" />
    <PageHeader
      title="自动追更"
      description="新集播出后自动搜 115 资源，管理剧集、动漫、综艺、纪录片的追更和电影上线追踪"
    />
    <AutograbTabs v-if="autograbAvailable"><AutograbView /></AutograbTabs>
    <StatusState
      v-else
      icon="download"
      title="自动追更需要桌面端或片库服务"
      hint="连上片库服务后，这里管理剧集、动漫、综艺、纪录片的追更和电影上线追踪"
    />
  </section>
</template>

<script setup lang="ts">
/**
 * 自动追更页（桌面 /autograb 与 NAS 共用同一个页面）：页头加「剧集 / 电影」标签，
 * 剧集栏是追更视图（待处理 → 在追的剧 → 记录）。
 */
import PageHeader from '@/components/PageHeader.vue'
import PageAtmosphere from '@/components/PageAtmosphere.vue'
import StatusState from '@/components/StatusState.vue'
import { AutograbView, autograbAvailable } from '@/features/autograb'

import AutograbTabs from '../components/AutograbTabs.vue'
import autograbHero from './autograb-hero.webp'
</script>

<style scoped>
.autograb-page {
  --page-atmosphere-glow: var(--page-glow-autograb);
  --atmosphere-inset-top: 0px;
  --atmosphere-inset-x: 0px;
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: 100%;
  padding: var(--content-padding-y) var(--content-padding-x) var(--space-8);
  overflow-y: auto;
}
:global(.app-layout.is-desktop.has-page-atmosphere .autograb-page) {
  padding-top: calc(var(--content-padding-y) + var(--shell-top));
}
</style>
