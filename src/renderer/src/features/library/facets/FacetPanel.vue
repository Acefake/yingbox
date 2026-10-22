<template>
  <!-- 筛选面板：类型一行直接点；下面按分面切页签，搜索 + 点选取值，即点即生效 -->
  <section class="facet-panel" aria-label="筛选" @keydown="onKeydown">
    <div class="facet-row">
      <span class="facet-row-label">类型</span>
      <div class="facet-chips">
        <UiChip
          v-for="kind in KIND_LABELS"
          :key="kind.value"
          :selected="isSelected(facets, 'kind', kind.value)"
          @click="toggle('kind', kind.value)"
        >
          {{ kind.label }}
          <span class="facet-count">{{ kindCounts[kind.value] ?? 0 }}</span>
        </UiChip>
      </div>
    </div>

    <div class="facet-row facet-row--tabs">
      <UiSegmented v-model="tab" size="sm" label="分面" :options="tabOptions" />
      <UiInput
        v-model="search"
        class="facet-search"
        variant="filled"
        size="sm"
        icon="search"
        clearable
        :placeholder="`搜索${facetLabel(tab)}`"
        :aria-label="`搜索${facetLabel(tab)}`"
      />
    </div>

    <div class="facet-values" :aria-busy="loading">
      <UiChip
        v-for="item in shown"
        :key="item.value"
        :selected="isSelected(facets, tab, item.value)"
        @click="toggle(tab, item.value)"
      >
        {{ item.value }}
        <span v-if="item.count !== null" class="facet-count">{{
          item.count
        }}</span>
      </UiChip>
      <p v-if="!loading && !shown.length" class="facet-empty">
        {{
          search.trim()
            ? `没有匹配的${facetLabel(tab)}`
            : `还没有${facetLabel(tab)}资料`
        }}
      </p>
    </div>

    <footer class="facet-footer">
      <span>{{ FACET_HINT }}</span>
      <UiButton
        v-if="activeCount(facets)"
        variant="plain"
        size="sm"
        label="清除全部"
        @click="facets = {}"
      />
    </footer>
  </section>
</template>

<script setup lang="ts">
/**
 * 海报墙筛选面板（番号库）。点一下就加入 / 去掉一个条件，海报墙随即刷新，不用「选好再添加」。
 * 当前页签里已选、但不在热门取值里的值排在最前，保证随时能取消。
 */
import { computed, toRef } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { isDismissKey } from '@/utils/keyboard'
import type {
  FacetField,
  FacetFilter,
  FacetListRequest,
} from '../../../../../shared/library/ipc'
import {
  FACET_HINT,
  FACET_TABS,
  KIND_LABELS,
  activeCount,
  facetLabel,
  isSelected,
  toggleValue,
} from './facet-rules'
import { useFacetValues } from './use-facet-values'

const props = defineProps<{
  /** 取值范围（来源 / 媒体库）。 */
  scope: Omit<FacetListRequest, 'field'>
  open: boolean
}>()
const facets = defineModel<FacetFilter>({ required: true })
const emit = defineEmits<{ close: [] }>()

const { tab, search, values, kindCounts, loading } = useFacetValues({
  open: toRef(props, 'open'),
  scope: () => props.scope,
})
const tabOptions = FACET_TABS.map(t => ({ ...t }))

/** 已选但不在列表里的值（数量未知）在前，然后是热门取值。 */
const shown = computed(() => {
  const listed = new Set(values.value.map(v => v.value))
  const picked = ((facets.value[tab.value] as string[] | undefined) ?? [])
    .filter(v => !listed.has(v))
    .map(value => ({ value, count: null as number | null }))
  return [...picked, ...values.value]
})

function toggle(field: FacetField, value: string): void {
  facets.value = toggleValue(facets.value, field, value)
}

/** Esc 关面板（输入法组字中的 Esc 只取消组字），不再冒泡到外层浮层。 */
function onKeydown(event: KeyboardEvent): void {
  if (!isDismissKey(event)) return
  event.stopPropagation()
  emit('close')
}
</script>

<style scoped>
.facet-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--bg-fill-tertiary);
}
.facet-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.facet-row--tabs {
  flex-wrap: wrap;
}
.facet-row-label {
  flex: none;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
}
.facet-chips,
.facet-values {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}
.facet-values {
  max-height: 168px;
  overflow-y: auto;
  align-content: flex-start;
}
.facet-search {
  flex: 0 1 220px;
  margin-left: auto;
}
.facet-count {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.facet-empty {
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.facet-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
</style>
