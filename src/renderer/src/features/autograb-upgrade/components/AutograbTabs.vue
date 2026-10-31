<template>
  <div class="autograb-tabs">
    <UiSegmented
      v-model="tab"
      class="autograb-tabs-switch"
      :options="TABS"
      label="追更类别"
      size="sm"
    />
    <slot v-if="tab === 'series'" />
    <UpgradePanel v-else-if="tab === 'upgrade'" />
    <MoviesPanel v-else />
  </div>
</template>

<script setup lang="ts">
/**
 * 自动追更页的三个标签：「剧集 / 洗版 / 电影」。剧集一栏是追更视图本身（由页面放进默认插槽），
 * 另外两栏是洗版和电影上线追踪。桌面端，或连着片库服务的网页端出现（路由按 autograbAvailable 决定）。
 */
import { ref } from 'vue'

import UiSegmented from '@/components/ui/UiSegmented.vue'

import MoviesPanel from './MoviesPanel.vue'
import UpgradePanel from './UpgradePanel.vue'

type Tab = 'series' | 'upgrade' | 'movies'
const TABS: { value: Tab; label: string }[] = [
  { value: 'series', label: '剧集' },
  { value: 'upgrade', label: '洗版' },
  { value: 'movies', label: '电影' },
]
const tab = ref<Tab>('series')
</script>

<style scoped>
.autograb-tabs {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.autograb-tabs-switch {
  align-self: flex-start;
}
</style>
