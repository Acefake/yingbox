<template>
  <div class="section-header" :class="{ mt: spaced }">
    <PageTitle as="h2" variant="section">{{ title }}</PageTitle>
    <span v-if="count !== undefined" class="yb-section-count">{{ count }}</span>
    <slot name="action" />
  </div>
  <div v-if="empty" class="empty">{{ emptyText }}</div>
  <div v-else class="smp-list"><slot /></div>
</template>

<script setup lang="ts">
/**
 * 数据源面板里的一个分组：标题（可带数量或操作按钮）+ 站点行列表，空时显示提示。
 * 多根节点组件，直接排在面板滚动区里。
 */
import PageTitle from '@/components/PageTitle.vue'

defineProps<{
  title: string
  count?: number
  /** 为 true 时显示 emptyText 而不是列表 */
  empty?: boolean
  emptyText?: string
  /** 非第一个分组：上方留出间距 */
  spaced?: boolean
}>()
</script>

<style scoped>
.section-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 var(--space-4) var(--space-2);
}
.section-header.mt {
  margin-top: var(--space-6);
}
.section-header .yb-section-count {
  display: inline;
  font-size: var(--text-xs);
}

/* 内嵌分组：和设置里的 SettingsGroup 同一种底板 */
.smp-list {
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--bg-glass);
}
.smp-list:empty {
  display: none;
}

.empty {
  padding: var(--space-4) var(--space-2);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  text-align: center;
}
</style>
