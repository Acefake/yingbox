<template>
  <component
    :is="as"
    :title="title"
    class="page-title"
    :class="{ 'is-section': variant === 'section' }"
  >
    <slot>{{ title }}</slot>
    <span v-if="count !== undefined" class="page-title-count">{{ count }}</span>
  </component>
</template>

<script setup lang="ts">
/**
 * 页面 / 区块标题。variant="page" 为页面大标题，"section" 为区块小标题；
 * count 显示在标题后的弱化数字。
 */
withDefaults(
  defineProps<{
    title?: string
    count?: number | string
    as?: 'h1' | 'h2' | 'h3'
    variant?: 'page' | 'section'
  }>(),
  { title: undefined, count: undefined, as: 'h1', variant: 'page' }
)
</script>

<style scoped>
.page-title {
  min-width: 0;
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--page-title-size);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.page-title.is-section {
  font-family: var(--font-sans);
  font-size: var(--text-lg);
  font-weight: var(--font-weight-medium);
  letter-spacing: -0.015em;
}
.page-title-count {
  margin-left: var(--space-2);
  color: var(--text-tertiary);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-regular);
  letter-spacing: 0;
  white-space: nowrap;
}
</style>
