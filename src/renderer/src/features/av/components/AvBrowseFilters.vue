<template>
  <div class="browse-filters" aria-label="浏览筛选">
    <div v-for="row in rows" :key="row.key" class="browse-filter-row">
      <span :id="`${uid}-${row.key}`" class="filter-label">{{
        row.label
      }}</span>
      <template v-if="row.key === 'source'">
        <UiButton
          class="source-trigger"
          icon="chevronDown"
          :label="
            row.options.find(o => o.value === modelValue.source)?.label ||
            '选择数据源'
          "
          aria-haspopup="dialog"
          :aria-expanded="sourceOpen"
          @click="openSources"
        />
        <span class="source-count">{{ row.options.length }} 个源</span>
      </template>
      <template v-else>
        <div
          v-scroll-x
          class="filter-options"
          :class="{ expanded: row.key === 'category' && expanded }"
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
          v-if="row.key === 'category' && row.options.length > 1"
          variant="plain"
          :label="expanded ? '收起' : '展开'"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        />
      </template>
    </div>
    <Teleport to="body">
      <div
        v-if="sourceOpen"
        class="source-backdrop"
        @click.self="sourceOpen = false"
      >
        <section
          ref="panel"
          class="source-panel"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`${uid}-title`"
          tabindex="-1"
          @keydown="trapTab"
        >
          <div class="source-heading">
            <h2 :id="`${uid}-title`">选择数据源</h2>
            <UiIconButton
              icon="close"
              label="关闭"
              @click="sourceOpen = false"
            />
          </div>
          <UiInput
            v-model="query"
            icon="search"
            placeholder="搜索数据源"
            aria-label="搜索数据源"
            clearable
          />
          <div class="source-options">
            <UiButton
              v-for="option in filteredSources"
              :key="option.value"
              :label="option.label"
              :pressed="modelValue.source === option.value"
              @click="select('source', option.value)"
            />
            <p v-if="!filteredSources.length" class="source-empty">
              没有匹配的数据源
            </p>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { MediaFilterRow } from '@/components/MediaFilterBar.vue'
import { UiButton, UiChip, UiIconButton, UiInput } from '@/components/ui'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { useModalFocus } from '@/composables/use-focus-trap'

const props = defineProps<{
  rows: MediaFilterRow[]
  modelValue: Record<string, string>
}>()
const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>]
}>()
const uid = useId()
const sourceOpen = ref(false)
const expanded = ref(false)
const query = ref('')
const panel = ref<HTMLElement | null>(null)
const trapTab = useModalFocus(panel, () => sourceOpen.value)
useEscapeLayer(
  () => sourceOpen.value,
  () => (sourceOpen.value = false)
)
const filteredSources = computed(() => {
  const text = query.value.trim().toLocaleLowerCase()
  return (props.rows.find(row => row.key === 'source')?.options ?? []).filter(
    option => option.label.toLocaleLowerCase().includes(text)
  )
})
const openSources = (): void => {
  query.value = ''
  sourceOpen.value = true
}
const select = (key: string, value: string): void => {
  if (key === 'source') sourceOpen.value = false
  if (props.modelValue[key] !== value)
    emit('update:modelValue', { ...props.modelValue, [key]: value })
}
watch(
  () => props.modelValue.source,
  () => (expanded.value = false)
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
.source-trigger {
  max-width: 65%;
  min-width: 0;
}
.source-trigger :deep(span) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-count {
  align-self: center;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  white-space: nowrap;
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
.source-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: var(--overlay-scrim-soft);
}
.source-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: min(560px, 100%);
  max-height: 75dvh;
  min-height: 0;
  padding: var(--space-5);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  outline: none;
}
.source-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.source-heading h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}
.source-options {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
  overflow-y: auto;
}
.source-options > * {
  flex-shrink: 0;
}
.source-empty {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
