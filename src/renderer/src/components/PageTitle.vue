<template>
  <component :is="as" :title="title" class="page-title" :class="{ 'is-section': variant === 'section' }">
    <slot>{{ title }}</slot>
    <span v-if="count !== undefined" class="page-title-count">{{ count }}</span>
  </component>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  count?: number | string
  as?: 'h1' | 'h2' | 'h3'
  variant?: 'page' | 'section'
}>(), { as: 'h1', variant: 'page' })
</script>

<style scoped>
.page-title {
  min-width: 0;
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: clamp(22px, 2vw, 28px);
  font-weight: 600;
  letter-spacing: -.025em;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.page-title.is-section { font-family: var(--font-sans); font-size: var(--text-lg); font-weight: 500; letter-spacing: -.015em; }
.page-title-count { margin-left: 8px; color: var(--text-tertiary); font-family: var(--font-sans); font-size: var(--text-sm); font-weight: 400; letter-spacing: 0; white-space: nowrap; }
</style>
