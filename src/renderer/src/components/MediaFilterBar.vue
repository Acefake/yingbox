<template>
  <div class="media-filter-bar" role="group" aria-label="媒体筛选">
    <div v-for="row in rows" :key="row.key" class="filter-row">
      <span class="filter-label">{{ row.label }}</span>
      <UiSegmented
        class="filter-options"
        size="sm"
        :label="row.label"
        :model-value="modelValue[row.key]"
        :options="row.options"
        @update:model-value="setFilter(row.key, $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 多行筛选条（类型 / 地区 / 年份…）。每行是一个 UiSegmented，
 * 选项多时自动换行（窄屏改为横向滚动）。
 */
import UiSegmented from '@/components/ui/UiSegmented.vue'

export interface MediaFilterOption {
  label: string
  value: string
}
export interface MediaFilterRow {
  key: string
  label: string
  options: MediaFilterOption[]
}

const props = defineProps<{
  rows: MediaFilterRow[]
  modelValue: Record<string, string>
}>()
const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>]
}>()

const setFilter = (key: string, value: string): void => {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>

<style scoped>
.media-filter-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.filter-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-5);
}
.filter-label {
  flex: 0 0 40px;
  width: 40px;
  padding-top: var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  white-space: nowrap;
}
/* 筛选项可能很多：去掉分段控件的底板，让选项自由换行 */
.filter-options {
  flex: 1 1 auto;
  flex-wrap: wrap;
  min-width: 0;
  padding: 0;
  background: transparent;
}
.filter-options :deep(.ui-segmented-item) {
  border-radius: var(--radius-full);
}
@media (max-width: 760px) {
  .filter-row {
    align-items: center;
    gap: var(--space-3);
  }
  .filter-label {
    padding-top: 0;
  }
  .filter-options {
    flex-wrap: nowrap;
    padding-bottom: var(--space-1);
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
  }
  .filter-options :deep(.ui-segmented-item) {
    flex-shrink: 0;
    height: 40px;
  }
}
</style>
