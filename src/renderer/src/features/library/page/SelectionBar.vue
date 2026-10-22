<template>
  <!-- 多选操作条 -->
  <Transition name="lib-selection">
    <div v-if="count > 0" class="lib-selection">
      <span class="lib-selection-count">已选 {{ count }} 项</span>
      <UiButton
        size="sm"
        variant="plain"
        icon="sparkle"
        label="重新识别"
        @click="emit('identify')"
      />
      <span v-tooltip="writerAvailable ? '' : WRITER_UNAVAILABLE">
        <UiButton
          size="sm"
          variant="plain"
          icon="save"
          label="写出 NFO 与图片"
          :disabled="!writerAvailable"
          @click="emit('write')"
        />
      </span>
      <span v-tooltip="writerAvailable ? '' : WRITER_UNAVAILABLE">
        <UiButton
          size="sm"
          variant="plain"
          icon="folder"
          label="整理…"
          :disabled="!writerAvailable"
          @click="emit('organize')"
        />
      </span>
      <UiButton icon="close" size="sm" label="取消" @click="emit('clear')" />
    </div>
  </Transition>
</template>

<script setup lang="ts">
/** 海报墙多选后浮在底部的操作条：重新识别、写出、整理、取消选择。count 为 0 时淡出。 */
import UiButton from '@/components/ui/UiButton.vue'
import { vTooltip } from '@/components/ui/tooltip'

import { WRITER_UNAVAILABLE } from '../writer/use-writer'

defineProps<{
  /** 已选条目数（不在海报墙视图时传 0）。 */
  count: number
  writerAvailable: boolean
}>()

const emit = defineEmits<{
  identify: []
  write: []
  organize: []
  clear: []
}>()
</script>

<style scoped>
.lib-selection {
  position: absolute;
  bottom: var(--space-6);
  left: 50%;
  z-index: var(--z-float);
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  transform: translateX(-50%);
}
.lib-selection > span {
  display: inline-flex;
}
.lib-selection-count {
  margin-right: var(--space-2);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  font-variant-numeric: tabular-nums;
}
.lib-selection-enter-active,
.lib-selection-leave-active {
  transition:
    opacity var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out);
}
.lib-selection-enter-from,
.lib-selection-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
