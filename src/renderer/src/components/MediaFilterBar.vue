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
.filter-label { width:56px; flex:0 0 56px; padding-top:5px; color:rgba(255,255,255,.42); font-size:13px; white-space:nowrap; }
.filter-options { display:flex; flex-wrap:wrap; gap:4px 18px; }
.filter-row:first-child .filter-options { flex-wrap:nowrap; overflow-x:auto; scrollbar-width:none; }
.filter-row:first-child .filter-options::-webkit-scrollbar { display:none; }
.filter-option { min-height:28px; padding:0 1px; border:0; color:rgba(255,255,255,.58); background:transparent; font-size:13px; cursor:pointer; transition:color .15s ease; }
.filter-option:hover { color:#fff; }
.filter-option.active { color:#3295ff; font-weight:600; }
@media (max-width: 760px) { .filter-row { gap:10px; } .filter-options { gap:3px 12px; } }
</style>
