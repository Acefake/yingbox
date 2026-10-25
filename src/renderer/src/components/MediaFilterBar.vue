<template>
  <div class="media-filter-bar" role="group" aria-label="媒体筛选">
    <div v-for="row in rows" :key="row.key" class="filter-row">
      <span :id="labelId(row.key)" class="filter-label">{{ row.label }}</span>
      <div
        class="filter-options"
        role="group"
        :aria-labelledby="labelId(row.key)"
      >
        <UiChip
          v-for="option in row.options"
          :key="option.value"
          size="md"
          :label="option.label"
          :selected="modelValue[row.key] === option.value"
          @click="setFilter(row.key, option.value)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 多行筛选条（类型 / 地区 / 年份…）。每行一组页面级筛选胶囊（UiChip size="md"，选中反色），
 * 与片库、直播、收藏页的筛选同一种控件；选项多时换行（窄屏改为横向滚动）。
 */
import UiChip from '@/components/ui/UiChip.vue'
import { useId } from 'vue'

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

const uid = useId()
const labelId = (key: string): string => `${uid}-${key}`

const setFilter = (key: string, value: string): void => {
  if (props.modelValue[key] === value) return
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>

<style scoped>
.media-filter-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.filter-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-5);
}
.filter-label {
  flex: 0 0 40px;
  width: 40px;
  line-height: var(--control-height);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.filter-options {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}
@media (max-width: 760px) {
  .filter-row {
    align-items: center;
    gap: var(--space-3);
  }
  .filter-options {
    flex-wrap: nowrap;
    padding: var(--space-0_5) 0 var(--space-1);
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
  }
}
</style>
