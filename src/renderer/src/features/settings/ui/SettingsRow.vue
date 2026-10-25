<template>
  <div class="settings-row" :class="{ 'is-stacked': stacked }">
    <div
      v-if="title || description || $slots.description"
      class="settings-row-text"
    >
      <div v-if="title" :id="labelId" class="settings-row-title">
        {{ title }}
      </div>
      <div v-if="description || $slots.description" class="settings-row-desc">
        <slot name="description">{{ description }}</slot>
      </div>
    </div>
    <div v-if="$slots.default" class="settings-row-control">
      <slot :label-id="labelId" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 设置分组里的一行：左边标题 + 说明，右边控件（默认插槽）。
 * stacked 时控件换到下一行并占满宽度（文本框、单选列表等宽控件用）。
 * 默认插槽会拿到 labelId，可给控件做 aria-labelledby。
 */
import { useId } from 'vue'

defineProps<{
  title?: string
  description?: string
  stacked?: boolean
}>()

const labelId = `settings-row-${useId()}`
</script>

<style scoped>
.settings-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  min-height: 54px;
  padding: var(--space-2_5) var(--space-4);
}
/* 内缩分隔线：两侧与文字对齐 */
.settings-row + .settings-row::before {
  position: absolute;
  top: 0;
  right: var(--space-4);
  left: var(--space-4);
  height: 1px;
  background: var(--separator);
  content: '';
}
.settings-row.is-stacked {
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-3);
}
.settings-row-text {
  flex: 1 1 auto;
  min-width: 0;
}
.settings-row-title {
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
}
.settings-row-desc {
  margin-top: var(--space-0_5);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}
.settings-row-control {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.settings-row-control:only-child {
  flex: 1 1 auto;
}
.settings-row.is-stacked .settings-row-control {
  flex-direction: column;
  align-items: stretch;
}
@media (max-width: 720px) {
  .settings-row:not(.is-stacked) {
    flex-wrap: wrap;
    gap: var(--space-3);
  }
}
</style>
