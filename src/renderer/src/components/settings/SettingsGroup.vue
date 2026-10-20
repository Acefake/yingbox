<template>
  <section class="settings-group" :aria-label="title">
    <h3 v-if="title" class="settings-group-title">{{ title }}</h3>
    <div class="settings-group-rows">
      <slot />
    </div>
    <p v-if="footer || $slots.footer" class="settings-group-footer">
      <slot name="footer">{{ footer }}</slot>
    </p>
  </section>
</template>

<script setup lang="ts">
/**
 * macOS 系统设置式的「内嵌分组」：浅填充圆角底板，里面是一行行 SettingsRow，
 * 行与行之间由 SettingsRow 自己画内缩细线。title 是底板上方的小标题，footer 是下方的补充说明。
 */
defineProps<{ title?: string; footer?: string }>()
</script>

<style scoped>
.settings-group + .settings-group {
  margin-top: var(--space-6);
}
.settings-group-title {
  margin: 0 0 var(--space-2);
  padding: 0 var(--space-4);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
}
.settings-group-rows {
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--bg-glass);
}
.settings-group-footer {
  margin: var(--space-2) 0 0;
  padding: 0 var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}
</style>
