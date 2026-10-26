<template>
  <div class="browse-filters" aria-label="浏览筛选">
    <div v-for="row in rows" :key="row.key" class="browse-filter-row">
      <span :id="`${uid}-${row.key}`" class="filter-label">{{
        row.label
      }}</span>
      <div
        :id="`${uid}-${row.key}-options`"
        v-scroll-x
        class="filter-options"
        :class="{ expanded: expanded[row.key] }"
        role="group"
        :aria-labelledby="`${uid}-${row.key}`"
      >
        <UiChip
          v-for="option in row.options"
          :key="option.value"
          size="md"
          :label="option.label"
          :selected="modelValue[row.key] === option.value"
          @click="select(row.key, option.value)"
        />
      </div>
      <UiButton
        v-if="
          (row.key === 'source' || row.key === 'category') &&
          row.options.length > 1
        "
        variant="plain"
        :label="expanded[row.key] ? '收起' : '展开'"
        :aria-label="`${expanded[row.key] ? '收起' : '展开'}${row.label}`"
        :aria-expanded="!!expanded[row.key]"
        :aria-controls="`${uid}-${row.key}-options`"
        @click="expanded[row.key] = !expanded[row.key]"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, useId, watch } from 'vue'
import type { MediaFilterRow } from '@/components/MediaFilterBar.vue'
import { UiButton, UiChip } from '@/components/ui'

const props = defineProps<{
  rows: MediaFilterRow[]
  modelValue: Record<string, string>
}>()
const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>]
}>()
const uid = useId()
const expanded = ref<Record<string, boolean>>({})
const select = (key: string, value: string): void => {
  if (props.modelValue[key] !== value)
    emit('update:modelValue', { ...props.modelValue, [key]: value })
}
watch(
  () => props.modelValue.source,
  () => (expanded.value.category = false)
)
</script>

<style scoped>
.browse-filters {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}
.browse-filter-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  min-width: 0;
}
.filter-label {
  flex: 0 0 auto;
  width: 40px;
  line-height: var(--control-height);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
.filter-options {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: var(--space-2);
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
.filter-options > * {
  flex-shrink: 0;
}
.filter-options.expanded {
  flex-wrap: wrap;
  max-height: 30vh;
  overflow-y: auto;
}
</style>
