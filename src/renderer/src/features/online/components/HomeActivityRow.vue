<template>
  <UiShelf
    v-show="tabs.length"
    ref="shelf"
    class="home-activity"
    title="我的动态"
    :kind="tab === 'watch' ? 'portrait' : 'landscape'"
    list
  >
    <template #actions>
      <UiSegmented
        :model-value="tab"
        :options="tabs"
        label="我的动态"
        @update:model-value="onTab"
      />
    </template>
    <RecentlyAddedRow
      pane
      :active="tab === 'added'"
      @count="setCount('added', $event)"
    />
    <LiveNowRow
      pane
      :active="tab === 'live'"
      @count="setCount('live', $event)"
    />
    <WatchlistRow
      pane
      section="online"
      :active="tab === 'watch'"
      @count="setCount('watch', $event)"
      @open="onWatch"
    />
  </UiShelf>
</template>

<script setup lang="ts">
/**
 * 首页「我的动态」：刚入库、正在直播、待看合成一排，用分段切换。
 * 空的那一类不出现在切换里；三类都没有时整排不显示。只渲染当前这一类的卡片。
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'

import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiShelf from '@/components/ui/UiShelf.vue'
import { RecentlyAddedRow } from '@/features/library'
import { LiveNowRow } from '@/features/live'
import { type WatchlistEntry, WatchlistRow } from '@/features/watchlist'

type ActivityTab = 'added' | 'live' | 'watch'

const emit = defineEmits<{ open: [detail: unknown] }>()

const tab = ref<ActivityTab>('added')
const counts = reactive<Record<ActivityTab, number>>({
  added: 0,
  live: 0,
  watch: 0,
})
const shelf = ref<{ $el?: Element } | null>(null)

const tabs = computed<SegmentedOption<ActivityTab>[]>(() => {
  const list: SegmentedOption<ActivityTab>[] = []
  if (counts.added)
    list.push({ value: 'added', label: '刚入库', count: counts.added })
  if (counts.live)
    list.push({ value: 'live', label: '正在直播', count: counts.live })
  if (counts.watch)
    list.push({ value: 'watch', label: '待看', count: counts.watch })
  return list
})

function setCount(key: ActivityTab, n: number): void {
  counts[key] = n
  if (tabs.value.some(item => item.value === tab.value)) return
  const next = tabs.value[0]
  if (next) tab.value = next.value
}

function onTab(value: ActivityTab): void {
  tab.value = value
}

function onWatch(entry: WatchlistEntry): void {
  if (entry.detail) emit('open', entry.detail)
}

watch(tab, async () => {
  await nextTick()
  const track = shelf.value?.$el?.querySelector('.yb-shelf-track')
  if (track) track.scrollLeft = 0
})
</script>
