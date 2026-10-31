<template>
  <section class="pending" aria-label="待处理">
    <h3 class="pending-title">待处理 · {{ episodes.length }} 集</h3>
    <div v-for="group in groups" :key="group.seriesId" class="pending-group">
      <h4 class="pending-name">{{ group.title }}</h4>
      <AutograbEpisodes
        best-only
        :episodes="group.episodes"
        :busy="busy"
        @grab="(key, index) => emit('grab', key, index)"
        @revert="key => emit('revert', key)"
        @skip="key => emit('skip', key)"
        @retry="key => emit('retry', key)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 自动追更页「待处理」：要用户动手的集（有候选待确认、空间不足、找不到），按剧分组；
 * 每集默认只露最佳候选和它的「转存」，其它候选折叠。
 */
import { computed } from 'vue'

import type { AutograbEpisode } from '../../../../../shared/contract/autograb'

import { groupBySeries } from '../autograb-rules'
import AutograbEpisodes from './AutograbEpisodes.vue'

const props = defineProps<{
  episodes: AutograbEpisode[]
  busy: ReadonlySet<string>
}>()
const emit = defineEmits<{
  grab: [key: string, index: number]
  revert: [key: string]
  skip: [key: string]
  retry: [key: string]
}>()

const groups = computed(() => groupBySeries(props.episodes))
</script>

<style scoped>
.pending {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.pending-title,
.pending-name {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
}

.pending-name {
  color: var(--text-primary);
}

.pending-group {
  display: flex;
  flex-direction: column;
}
</style>
