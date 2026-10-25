<template>
  <div class="lib-empty" :class="{ 'is-inline': inline }">
    <UiIcon v-if="icon" :name="icon" size="lg" />
    <h2>{{ title }}</h2>
    <p v-if="text">{{ text }}</p>
    <slot />
  </div>
</template>

<script setup lang="ts">
/** 媒体库页面的空状态：图标、标题、说明，下方可放按钮。inline 时不撑满高度（放在海报墙里）。 */
import UiIcon from '@/components/ui/UiIcon.vue'

defineProps<{
  title: string
  text?: string
  icon?: 'movie' | 'tv' | 'tag'
  inline?: boolean
}>()
</script>

<style scoped>
.lib-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  height: 100%;
  padding: var(--space-11) var(--space-8);
  color: var(--text-tertiary);
  text-align: center;
}
.lib-empty.is-inline {
  height: auto;
}
/* 空状态的大图标：48px 四级灰，和标题一起成为视觉中心 */
.lib-empty .app-icon {
  width: 48px;
  height: 48px;
  color: var(--text-quaternary);
}
.lib-empty h2 {
  margin: var(--space-2) 0 0;
  color: var(--text-primary);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
}
.lib-empty p {
  max-width: 420px;
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}
</style>
