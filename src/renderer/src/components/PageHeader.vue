<template>
  <header class="page-header">
    <div class="page-header-copy">
      <PageTitle :title="title" :count="count" :as="as" :variant="variant" />
      <p v-if="description" class="page-header-description">{{ description }}</p>
      <slot name="status" />
    </div>
    <div v-if="$slots.actions" class="page-header-actions"><slot name="actions" /></div>
  </header>
</template>

<script setup lang="ts">
import PageTitle from './PageTitle.vue'
withDefaults(defineProps<{
  title: string
  description?: string
  count?: number | string
  as?: 'h1' | 'h2' | 'h3'
  variant?: 'page' | 'section'
}>(), { as: 'h1', variant: 'page' })
</script>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-width: 0; margin: 0; }
.page-header-copy { min-width: 0; flex: 1; }
.page-header-description { margin: 6px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; max-width: 78ch; }
.page-header-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
@media (max-width: 600px) { .page-header { gap: 10px; } }
</style>
