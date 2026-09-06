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
export interface MediaFilterOption { label: string; value: string }
export interface MediaFilterRow { key: string; label: string; options: MediaFilterOption[] }

const props = defineProps<{ rows: MediaFilterRow[]; modelValue: Record<string, string> }>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string>] }>()

const setFilter = (key: string, value: string) => {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>

<style scoped>
.media-filter-bar { display:flex; flex-direction:column; gap:13px; padding:0 0 8px; }
.filter-row { display:flex; align-items:flex-start; gap:20px; }
.filter-label {
  width:56px; flex:0 0 56px; padding-top:5px;
  color: var(--text-tertiary);
  font-size:13px; font-weight: var(--font-weight-medium);
  white-space:nowrap;
}
.filter-options { display:flex; flex:1 1 auto; flex-wrap:wrap; gap:4px 18px; min-width:0; }
.filter-option {
  min-height:28px; padding:0 1px; border:0;
  color: var(--text-secondary);
  background:transparent; font-size:13px; white-space:nowrap; cursor:pointer;
  transition: color .15s ease;
}
.filter-option:hover { color: var(--text-primary); }
.filter-option.active {
  color: var(--accent-text);
  font-weight:600;
}
@media (max-width: 760px) { .filter-row { gap:10px; } .filter-options { gap:3px 12px; } }
</style>
