<template>
  <div class="smp-toolbar">
    <UiSegmented
      v-if="tabs.length > 1"
      v-model="activeTab"
      size="sm"
      label="数据源分类"
      :options="tabs"
    />
    <span v-if="checkingAll" class="smp-status" role="status">
      检测中 {{ checkedCount }}/{{ checkingTotal }}
    </span>
    <div class="smp-toolbar-actions">
      <UiButton
        v-if="totalFail"
        class="smp-fail-btn"
        size="sm"
        :label="`停用失效源（${totalFail}）`"
        @click="disableAllFailed"
      />
      <UiIconButton
        icon="refresh"
        label="一键更新：同步并检测全部数据源"
        :loading="updatingSources"
        @click="updateSources"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 数据源面板的工具栏：分类切换（只有一个分类时不显示）、检测进度、
 * 「停用失效源」与「一键更新」。统计与操作在 use-source-totals。
 */
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { useSourceTotals } from '../composables/use-source-totals'
import {
  checkedCount,
  checkingAll,
  checkingTotal,
} from '../composables/use-source-refresh'
import type { SourceTab } from '../utils/source-rules'

defineProps<{ tabs: { value: SourceTab; label: string }[] }>()
const activeTab = defineModel<SourceTab>({ required: true })

const { totalFail, updatingSources, updateSources, disableAllFailed } =
  useSourceTotals()
</script>

<style scoped>
.smp-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
}
/* 嵌入设置窗口时（面板外层是 .smp-embedded）去掉左右留白 */
:global(.smp-embedded) .smp-toolbar {
  padding: 0 0 var(--space-4);
}
.smp-toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}
.smp-status {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.smp-fail-btn {
  color: var(--danger);
}
</style>
