<template>
  <div class="yb-section-head">
    <h2 class="yb-section-title">
      <UiPressable
        v-if="more"
        class="yb-section-more"
        :label="moreLabel || `查看全部${title}`"
        @click="emit('more')"
        >{{ title }}<UiIcon name="forward" size="lg"
      /></UiPressable>
      <template v-else>{{ title }}</template>
    </h2>
    <div v-if="$slots.default" class="yb-section-actions"><slot /></div>
  </div>
</template>

<script setup lang="ts">
/**
 * 分区标题（Apple TV 式）：粗体大字，可点时后面跟一个灰色 ›（more）。右侧插槽放计数、滚动键等小控件。
 */
import UiIcon from './UiIcon.vue'
import UiPressable from './UiPressable.vue'

defineProps<{
  title: string
  /** 标题可点（后面带 ›），点了 emit more */
  more?: boolean
  /** 可点时的无障碍名称；默认「查看全部 + 标题」 */
  moreLabel?: string
}>()
const emit = defineEmits<{ more: [] }>()
</script>

<style>
.yb-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: var(--control-height);
  margin-bottom: var(--space-3_5);
}
.yb-section-title {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-bold); /* style-tokens: visual（标题） */
  line-height: 1.2;
  letter-spacing: 0.005em;
}
.yb-section-more {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  border-radius: var(--radius-sm);
}
.yb-section-more .app-icon {
  margin-top: var(--space-0_5);
  color: var(--text-tertiary);
  transition: transform var(--duration-fast) var(--ease-out);
}
.yb-section-more:hover .app-icon {
  color: var(--text-secondary);
  transform: translateX(2px);
}
.yb-section-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
}
</style>
