<template>
  <div class="ui-empty-state empty-placeholder">
    <svg
      v-if="iconPath"
      class="empty-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path :d="iconPath" />
    </svg>
    <UiIcon v-else class="empty-icon" :name="icon" />
    <p class="empty-title">{{ title }}</p>
    <p class="empty-subtitle">{{ subtitle }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 列表为空时的大号占位：图标 + 标题 + 说明。
 * 优先用 icon（UiIcon 名称）；iconPath 仅为兼容旧调用方传入的自定义路径。
 */
import type { IconName } from '@/components/ui/icons'
import UiIcon from '@/components/ui/UiIcon.vue'

withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    icon?: IconName
    /** @deprecated 改用 icon */
    iconPath?: string
  }>(),
  {
    title: '欢迎使用本项目',
    subtitle: '请先添加文件夹，点击[+添加]按钮添加文件夹',
    icon: 'movie',
    iconPath: undefined,
  }
)
</script>

<style scoped>
.empty-placeholder {
  color: var(--text-secondary);
}
.empty-icon {
  width: 64px;
  height: 64px;
  margin-bottom: var(--space-2);
  color: var(--text-tertiary);
  stroke-width: 1.25;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.empty-title {
  margin: 0 0 var(--space-1);
  color: var(--text-primary);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
}
.empty-subtitle {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
</style>
