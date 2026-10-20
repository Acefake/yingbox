<template>
  <header class="dialog-titlebar">
    <div class="dialog-titlebar-caption">
      <UiIcon v-if="icon" :name="icon" size="sm" />
      <span class="dialog-titlebar-title">
        <slot>{{ title }}</slot>
      </span>
    </div>
    <div v-if="$slots.actions" class="dialog-titlebar-actions">
      <slot name="actions" />
    </div>
    <UiIconButton
      v-if="closable"
      class="dialog-titlebar-close"
      icon="close"
      size="sm"
      :label="closeLabel"
      @click="$emit('close', $event)"
    />
  </header>
</template>

<script setup lang="ts">
/**
 * 弹窗 / 浮层统一的标题栏：左侧图标 + 标题，右侧可选操作区和关闭按钮。
 * 关闭按钮是 UiIconButton，closeLabel 同时作为无障碍名称和悬停提示。
 */
import type { IconName } from '@/components/ui/icons'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'

withDefaults(
  defineProps<{
    title?: string
    icon?: IconName
    closable?: boolean
    closeLabel?: string
  }>(),
  { closable: true, closeLabel: '关闭' }
)
defineEmits<{ close: [event: MouseEvent] }>()
</script>

<style scoped>
.dialog-titlebar {
  display: flex;
  flex: 0 0 40px;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  height: 40px;
  min-height: 40px;
  margin: 0;
  padding: 0 var(--space-2) 0 0;
  border-bottom: 1px solid var(--separator);
  background: var(--bg-elevated);
  color: var(--text-primary);
  user-select: none;
  -webkit-app-region: no-drag;
}
.dialog-titlebar-caption {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: 0 var(--space-4);
}
.dialog-titlebar-caption > .app-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}
.dialog-titlebar-title {
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  line-height: var(--leading-normal);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dialog-titlebar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
</style>
