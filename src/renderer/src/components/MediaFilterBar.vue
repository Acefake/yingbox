<template>
  <div class="media-filter-bar" aria-label="媒体筛选">
    <div v-for="row in rows" :key="row.key" class="filter-row">
      <span class="filter-label">{{ row.label }}</span>
      <div class="filter-options" role="group" :aria-label="row.label">
        <button
          v-for="option in row.options"
          :key="option.value"
          type="button"
          class="filter-option"
          :class="{ active: modelValue[row.key] === option.value }"
          @click="setFilter(row.key, option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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

const setFilter = (key: string, value: string) => {
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
  gap: 20px;
}
.filter-label {
  width: 40px;
  flex: 0 0 40px;
  padding-top: 6px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: 400;
  white-space: nowrap;
}
.filter-options {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: var(--space-1);
  min-width: 0;
}
.filter-option {
  min-height: var(--control-height-sm);
  padding: 0 var(--space-3);
  border: 0;
  color: var(--text-secondary);
  background: transparent;
  font-size: var(--text-sm);
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;

  border-radius: var(--radius-full);
}
.filter-option:hover {
  color: var(--text-primary);
  background: var(--bg-glass);
}
.filter-option.active {
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);
  background: var(--bg-active);
}
@media (max-width: 760px) {
  .filter-row {
    gap: 10px;
    align-items: center;
  }
  .filter-option {
    flex-shrink: 0;
    min-height: 40px;
  }
  .filter-label { width: 40px; flex-basis: 40px; padding-top: 0; }
  .filter-options {
    gap: 6px;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 4px;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
  }
}
</style>
