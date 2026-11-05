<template>
  <div ref="root" class="lib-facet-popover" role="dialog" aria-label="筛选">
    <FacetPanel
      v-model="facets"
      :scope="scope"
      :open="true"
      @close="emit('close')"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 筛选弹层：挂在页头「筛选」按钮下面，材质与「更多」菜单一致（--menu-bg + 玻璃模糊）。
 * 点外面（触发按钮除外，交给它自己开关）、窗口失焦或 Esc 关闭；选值即点即生效，不关弹层。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { useEscapeLayer } from '@/composables/use-escape-layer'

import type {
  FacetFilter,
  FacetListRequest,
} from '../../../../../shared/library/ipc'
import FacetPanel from './FacetPanel.vue'

const props = defineProps<{
  scope: Omit<FacetListRequest, 'field'>
  /** 触发弹层的元素：在它上面按下不算「点外面」 */
  trigger: HTMLElement | null
}>()
const facets = defineModel<FacetFilter>({ required: true })
const emit = defineEmits<{ close: [] }>()

const root = ref<HTMLElement | null>(null)

useEscapeLayer(
  () => true,
  () => emit('close')
)

function onPointerDown(event: PointerEvent): void {
  const target = event.target as Node
  if (root.value?.contains(target) || props.trigger?.contains(target)) return
  emit('close')
}

function onBlur(): void {
  emit('close')
}

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('blur', onBlur)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('blur', onBlur)
})
</script>

<style scoped>
.lib-facet-popover {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  z-index: var(--z-dropdown);
  width: min(560px, 90vw);
  max-height: 70vh;
  overflow-y: auto;
  border-radius: var(--radius-xl);
  background: var(--menu-bg);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: var(--glass-filter);
  backdrop-filter: var(--glass-filter);
}
/* 面板自带的实色卡片底去掉，用弹层的玻璃底 */
.lib-facet-popover :deep(.facet-panel) {
  background: transparent;
  box-shadow: none;
}
</style>
