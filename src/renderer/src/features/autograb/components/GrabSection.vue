<template>
  <section class="grab-section" :aria-labelledby="id">
    <div class="grab-section-head">
      <h3 :id="id" class="grab-section-title">
        {{ title
        }}<span v-if="count" class="grab-section-count">{{ count }}</span>
      </h3>
      <div v-if="$slots.actions" class="grab-section-actions">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </section>
</template>

<script setup lang="ts">
/**
 * 自动追更页（剧集 / 电影 / 洗版三栏）的一个分区：标题 + 灰色计数，右侧 actions 插槽放筛选、搜索或批量操作。
 * 卡片网格用 .grab-tasks（自适应列数），与剧集栏「需要你处理」同一套。
 */
import { useId } from 'vue'

defineProps<{
  title: string
  /** 标题旁的灰字：「3 集」「7 部」 */
  count?: string
}>()

const id = useId()
</script>

<style scoped>
.grab-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.grab-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.grab-section-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}

.grab-section-count {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-regular);
  font-variant-numeric: tabular-nums;
}

.grab-section-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}

.grab-section :slotted(.grab-tasks) {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.grab-section :slotted(.grab-tasks > li) {
  display: flex;
}

.grab-section :slotted(.grab-tasks > li > *) {
  flex: 1;
}
</style>
