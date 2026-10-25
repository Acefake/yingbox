<template>
  <dialog
    ref="dialogEl"
    class="discover-dialog"
    :aria-labelledby="titleId"
    @cancel.prevent="emit('close')"
    @keydown="guardDialogEscape"
  >
    <header class="discover-dialog-head">
      <h2 :id="titleId" class="discover-dialog-title">找 115 资源</h2>
      <UiIconButton
        icon="close"
        size="sm"
        label="关闭"
        @click="emit('close')"
      />
    </header>
    <DiscoverCandidates :target="target" @played="emit('close')" />
  </dialog>
</template>

<script setup lang="ts">
/**
 * 首页豆瓣卡「找 115 资源」的弹窗：原生 <dialog> showModal（焦点困在框内、Esc 关闭），内容是共用的候选面板。
 * 由 open-dialog.ts 渲染到 body，页面里不要直接使用。
 */
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'

import UiIconButton from '@/components/ui/UiIconButton.vue'
import { guardDialogEscape } from '@/composables/use-escape-layer'

import type { DiscoverTitle } from '../discover-rules'
import DiscoverCandidates from './DiscoverCandidates.vue'

defineProps<{ target: DiscoverTitle }>()
const emit = defineEmits<{ close: [] }>()

const dialogEl = ref<HTMLDialogElement | null>(null)
const titleId = useId()

onMounted(() => dialogEl.value?.showModal())
onBeforeUnmount(() => dialogEl.value?.close())
</script>

<style scoped>
.discover-dialog {
  box-sizing: border-box;
  width: 520px;
  max-width: calc(100vw - var(--space-8));
  margin: auto;
  padding: var(--space-5);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-family: var(--font-sans);
  box-shadow: var(--shadow-lg);
}

.discover-dialog::backdrop {
  background: var(--overlay-scrim-soft);
}

.discover-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.discover-dialog-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}
</style>
