<template>
  <!-- 已选条件：面板收起时也一直在，点一下去掉 -->
  <div
    v-if="items.length"
    class="active-facets"
    role="group"
    aria-label="已选筛选"
  >
    <UiChip
      v-for="item in items"
      :key="`${item.field}:${item.value}`"
      selected
      :aria-label="`去掉筛选 ${facetLabel(item.field)} ${item.label}`"
      @click="facets = toggleValue(facets, item.field, item.value)"
    >
      <span class="active-facets-field">{{ facetLabel(item.field) }}</span>
      {{ item.label }}
      <UiIcon name="close" size="sm" />
    </UiChip>
    <UiButton variant="plain" size="sm" label="清除" @click="facets = {}" />
  </div>
</template>

<script setup lang="ts">
/** 海报墙上方的已选筛选条：每个条件一个胶囊，点击去掉；末尾一键清除。 */
import { computed } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import type { FacetFilter } from '../../../../../shared/library/ipc'
import { activeFacets, facetLabel, toggleValue } from './facet-rules'

const facets = defineModel<FacetFilter>({ required: true })
const items = computed(() => activeFacets(facets.value))
</script>

<style scoped>
.active-facets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.active-facets-field {
  color: var(--text-tertiary);
}
</style>
