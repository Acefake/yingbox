<template>
  <header class="page-header flex min-w-0 flex-wrap items-center justify-between gap-4">
    <div class="min-w-0 flex-1">
      <PageTitle :title="title" :count="count" :as="as" :variant="variant" />
      <p v-if="description" class="mt-2 max-w-prose text-sm leading-relaxed text-yb-text-secondary">{{ description }}</p>
      <slot name="status" />
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2"><slot name="actions" /></div>
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
