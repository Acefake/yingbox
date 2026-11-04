<template>
  <section
    class="settings-group"
    :class="{ 'is-joined': joined }"
    :aria-label="title"
  >
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
 * 设置的内嵌分组：浅填充圆角底板，里面是一行行 SettingsRow，行与行之间由 SettingsRow 自己画内缩细线。
 * title 是底板里的小节标题，footer 是该节末尾的补充说明。
 * 默认每个分组是独立的一块；joined 表示和上一组属于同一主题，并进上一组的底板，中间只留一条细线。
 */
defineProps<{ title?: string; footer?: string; joined?: boolean }>()
</script>

<style scoped>
.settings-group {
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--bg-glass);
}
.settings-group + .settings-group {
  margin-top: var(--space-6);
}
/* joined：并进上一组的底板，中间只留一条细线 */
.settings-group + .settings-group:where(.is-joined) {
  margin-top: 0;
  border-top: 1px solid var(--separator);
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
.settings-group:has(+ .settings-group:where(.is-joined)) {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.settings-group-title {
  margin: 0;
  padding: var(--space-3) var(--space-4) var(--space-1);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
}
.settings-group-footer {
  margin: 0;
  padding: var(--space-1) var(--space-4) var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}
</style>
