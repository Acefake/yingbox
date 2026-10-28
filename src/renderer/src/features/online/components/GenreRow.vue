<template>
  <nav class="quick-browse" aria-label="快速浏览">
    <span class="quick-lead">快速浏览</span>
    <UiChip
      v-for="genre in HOME_GENRES"
      :key="genre"
      size="md"
      :label="genre"
      @click="emit('open', genre)"
    />
    <UiChip class="quick-more" size="md" @click="emit('collections')">
      精选片单<UiIcon name="forward" size="sm" />
    </UiChip>
  </nav>
</template>

<script setup lang="ts">
/**
 * 首页 Hero 下的「快速浏览」：一排 36px 胶囊（科幻、动作等），末尾是「精选片单」。
 * 点类型 emit open，在线页打开该类型的浏览页（默认电影）；点精选片单 emit collections，页面滚到片单那一排。
 */
import UiChip from '@/components/ui/UiChip.vue'
import UiIcon from '@/components/ui/UiIcon.vue'

import { HOME_GENRES } from '../utils/browse-target'

const emit = defineEmits<{ open: [genre: string]; collections: [] }>()
</script>

<style scoped>
.quick-browse {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.quick-lead {
  padding-right: var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.quick-more {
  background: var(--control-bg);
  color: var(--text-primary);
}
.quick-more:hover {
  background: var(--control-bg-hover);
}
</style>
