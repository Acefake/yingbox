<template>
  <!-- 待确认提示：海报墙上「• N 部待确认 去处理 ›」，待确认视图里换成「返回资料库」 -->
  <div v-if="text || view === 'review'" class="lib-review-hint">
    <span class="lib-review-hint-dot" aria-hidden="true" />
    <span class="lib-review-hint-text">{{ text ?? '没有待确认的条目' }}</span>
    <UiButton
      v-if="view === 'review'"
      variant="plain"
      size="sm"
      label="返回资料库"
      @click="view = 'wall'"
    />
    <UiButton
      v-else
      variant="plain"
      size="sm"
      label="去处理 ›"
      @click="view = 'review'"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 标题下方的待确认提示：有待确认（含未匹配）条目时显示「• N 部待确认 去处理 ›」，点了进入待确认队列（ReviewQueue）；
 * N 为 0 时海报墙上不显示。待确认视图里同一行给出「返回资料库」。
 */
import { computed } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'

import { reviewHintText } from './browse-rules'
import type { LibraryView } from './LibraryToolbar.vue'

const props = defineProps<{ count: number }>()
const view = defineModel<LibraryView>('view', { required: true })

const text = computed(() => reviewHintText(props.count))
</script>

<style scoped>
.lib-review-hint {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: calc(var(--space-2) * -1);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.lib-review-hint-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warning);
}
.lib-review-hint-text {
  font-variant-numeric: tabular-nums;
}
</style>
