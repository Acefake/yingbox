<template>
  <div class="episode-panel yb-glass is-media" @click.stop @contextmenu.stop>
    <h4 class="episode-panel-title">选集</h4>
    <ul ref="listEl" class="episode-panel-list">
      <li v-for="(label, index) in entries" :key="index">
        <UiListRow
          class="episode-panel-row"
          :selected="index === current"
          :aria-pressed="index === current"
          @click="emit('pick', index)"
        >
          {{ label }}
        </UiListRow>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/** 选集面板（控制栏「选集」打开）：当前线路的全部集，一集一行，点一集直接跳过去。 */
import { nextTick, onMounted, ref } from 'vue'

import UiListRow from '@/components/ui/UiListRow.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'

const props = defineProps<{
  /** 每集显示名 */
  entries: string[]
  /** 正在播放的集下标 */
  current: number
}>()
const emit = defineEmits<{
  close: []
  pick: [index: number]
}>()

// 面板挂载即打开（父组件 v-if），Esc 只关面板
useEscapeLayer(
  () => true,
  () => emit('close')
)

const listEl = ref<HTMLElement | null>(null)

onMounted(async () => {
  await nextTick()
  listEl.value?.children[props.current]?.scrollIntoView({ block: 'center' })
})
</script>

<style scoped>
/* 玻璃材质（底色、模糊、投影）来自 .yb-glass.is-media，这里只管形状与布局 */
.episode-panel {
  position: absolute;
  right: var(--space-3);
  bottom: 56px; /* style-tokens: layout（避开底部控制栏） */
  z-index: var(--z-popover);
  width: min(300px, 86vw);
  max-width: calc(100% - 2 * var(--space-3));
  max-height: min(480px, 70vh);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-2) var(--space-2);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

.episode-panel-title {
  margin: 0;
  padding: 0 var(--space-2);
  font-size: var(--text-md);
  font-weight: 600;
}

.episode-panel-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
}
</style>
