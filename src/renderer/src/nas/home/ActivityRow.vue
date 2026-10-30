<template>
  <UiShelf
    v-show="tabs.length"
    ref="shelf"
    title="我的动态"
    :kind="tab === 'watch' ? 'portrait' : 'landscape'"
    list
  >
    <template #actions
      ><UiSegmented v-model="tab" :options="tabs" label="我的动态"
    /></template>
    <RecentlyAddedRow
      pane
      :active="tab === 'added'"
      @count="setCount('added', $event)"
    />
    <WatchlistRow
      pane
      section="online"
      :active="tab === 'watch'"
      @count="setCount('watch', $event)"
      @open="entry => entry.detail && emit('open', entry.detail)"
    />
  </UiShelf>
</template>

<script setup lang="ts">
/** 原首页动态货架在 NAS 中保留刚入库和待看。 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import UiShelf from '@/components/ui/UiShelf.vue'
import UiSegmented, {
  type SegmentedOption,
} from '@/components/ui/UiSegmented.vue'
import { RecentlyAddedRow } from '@/features/library'
import { WatchlistRow } from '@/features/watchlist'
type Tab = 'added' | 'watch'
const emit = defineEmits<{ open: [detail: unknown] }>()
const tab = ref<Tab>('added')
const counts = reactive({ added: 0, watch: 0 })
const shelf = ref<{ $el?: Element } | null>(null)
const tabs = computed<SegmentedOption<Tab>[]>(() => [
  ...(counts.added
    ? [{ value: 'added' as const, label: '刚入库', count: counts.added }]
    : []),
  ...(counts.watch
    ? [{ value: 'watch' as const, label: '待看', count: counts.watch }]
    : []),
])

function setCount(key: Tab, count: number): void {
  counts[key] = count
  if (!counts[tab.value] && tabs.value[0]) tab.value = tabs.value[0].value
}

watch(tab, async () => {
  await nextTick()
  const track = shelf.value?.$el?.querySelector('.yb-shelf-track')
  if (track) track.scrollLeft = 0
})
</script>
