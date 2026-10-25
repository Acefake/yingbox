<template>
  <UiPressable
    v-tooltip="mark.title"
    class="ag-mark"
    :data-kind="mark.kind"
    :aria-label="`${mark.label}，打开追更面板`"
    @click.stop="emit('open', mark.key)"
  >
    <span class="ag-mark-dot" aria-hidden="true" />
    <span aria-hidden="true">{{ mark.label }}</span>
  </UiPressable>
</template>

<script setup lang="ts">
/**
 * 追更小标记（日历卡片左上角）：圆点 + 两三个字的状态，悬停看详情，点了打开追更面板并定位到这一集。
 * 位置由使用方的 class 决定，这里只管外观。
 */
import { UiPressable, vTooltip } from '@/components/ui'

import type { AutograbMark } from '../autograb-rules'

defineProps<{ mark: AutograbMark }>()
const emit = defineEmits<{ open: [key: string] }>()
</script>

<style scoped>
.ag-mark {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--overlay-scrim);
  color: var(--media-text);
  font-size: var(--text-2xs);
  line-height: 18px;
}

.ag-mark-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--media-text-secondary);
}

.ag-mark[data-kind='pending'] .ag-mark-dot {
  background: var(--accent);
}

.ag-mark[data-kind='saved'] .ag-mark-dot,
.ag-mark[data-kind='ingesting'] .ag-mark-dot {
  background: var(--success);
}

.ag-mark[data-kind='failed'] .ag-mark-dot {
  background: var(--danger);
}

.ag-mark[data-kind='searching'] .ag-mark-dot,
.ag-mark[data-kind='ingesting'] .ag-mark-dot {
  animation: ag-mark-pulse var(--duration-pulse) ease-in-out infinite alternate;
}

@keyframes ag-mark-pulse {
  from {
    opacity: 1;
  }
  to {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ag-mark-dot {
    animation: none !important;
  }
}
</style>
