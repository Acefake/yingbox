<template>
  <div
    ref="root"
    class="lib-genre-popover"
    role="menu"
    aria-label="全部类型"
    :style="{ left: `${left}px` }"
  >
    <div class="lib-genre-popover-title" role="presentation">全部类型</div>
    <div class="lib-genre-popover-grid">
      <UiListRow
        v-for="g in genres"
        :key="g.value"
        class="lib-genre-popover-item"
        role="menuitemradio"
        :aria-checked="g.value === selected"
        :selected="g.value === selected"
        @click="emit('pick', g.value)"
      >
        {{ g.value }}
        <template #trailing>
          <span class="lib-genre-popover-count">{{
            g.count.toLocaleString('zh-CN')
          }}</span>
        </template>
      </UiListRow>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 「全部类型」浮层：两列列出本分区的全部类型，每个类型后面是片数，选中的类型填 --bg-active。
 * 材质与「更多」菜单一致（--menu-bg + 玻璃模糊，压在海报上也读得清）。
 *
 * 挂在胶囊行外层（不被横向滚动裁掉），left 由调用方按「全部类型」胶囊的位置算好。
 * 点外面（触发胶囊除外，交给它自己开关）、窗口失焦或 Esc 关闭；选一项交回 pick，由调用方决定关不关。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

import UiListRow from '@/components/ui/UiListRow.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'

import type { FacetValue } from '../../../../../shared/library/ipc'

const props = defineProps<{
  genres: FacetValue[]
  selected: string | null
  /** 相对胶囊行外层的左边距（px） */
  left: number
  /** 触发浮层的元素：在它上面按下不算「点外面」 */
  trigger: HTMLElement | null
}>()
const emit = defineEmits<{ pick: [genre: string]; close: [] }>()

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
.lib-genre-popover {
  position: absolute;
  top: calc(100% + var(--space-2));
  z-index: var(--z-dropdown);
  width: 400px;
  max-width: 100%;
  max-height: 60vh;
  overflow-y: auto;
  padding: var(--space-2);
  border-radius: var(--radius-xl);
  background: var(--menu-bg);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: var(--glass-filter);
  backdrop-filter: var(--glass-filter);
}
.lib-genre-popover-title {
  padding: var(--space-2) var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
}
.lib-genre-popover-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-0_5) var(--space-2);
}
.lib-genre-popover-item {
  white-space: nowrap;
}
.lib-genre-popover-count {
  font-variant-numeric: tabular-nums;
}
</style>
