<template>
  <UiShelf
    v-if="alive"
    class="hot-shelf"
    title="热门"
    kind="portrait"
    more
    :more-label="`浏览全部${kindLabel}`"
    list
    @more="emit('more', kind)"
  >
    <template #actions>
      <UiSegmented
        :model-value="kind"
        :options="KIND_OPTIONS"
        label="热门分类"
        @update:model-value="kind = $event"
      />
    </template>
    <template v-if="shelfItems.length">
      <UiPosterCard
        v-for="item in shelfItems"
        :key="item.url"
        role="listitem"
        thumb
        :title="item.title"
        :cover="item.cover"
        :subtitle="subtitleOf(item)"
        :favorite="isFavorite(item)"
        :preview="doubanPreviewSource(item)"
        @open="emit('open', item)"
        @toggle-favorite="toggleFavorite(item)"
      >
        <template #overlay>
          <UiRatingBadge :douban="item.rate" :tmdb="item.tmdbRate" />
        </template>
      </UiPosterCard>
    </template>
    <template v-else-if="pending">
      <span
        v-for="n in SKELETON_COUNT"
        :key="n"
        class="hot-shelf-skeleton"
        aria-hidden="true"
      />
    </template>
    <p v-else class="hot-empty">这一类暂时没有内容</p>
  </UiShelf>
</template>

<script setup lang="ts">
/**
 * 首页的「热门」货架：电影 / 剧集分段切换，只渲染当前这一类（另一类切过来才取、才画）。
 * 海报左下角是评分角标，海报下是片名和「年份 · 类型」。标题的 › 打开对应的浏览页。
 * 当前类还在取时显示占位；两类都取完且都是空的，整排不渲染。
 */
import { computed, ref, watch } from 'vue'

import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiRatingBadge from '@/components/ui/UiRatingBadge.vue'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiShelf from '@/components/ui/UiShelf.vue'

import type { DoubanKind } from '../../../../../shared/douban/query'
import { isFavorite, toggleFavorite } from '../composables/favorites'
import { useHotFeed } from '../composables/use-home-browse'
import type { DoubanItem } from '../types'
import { doubanPreviewSource } from '../utils/douban-preview'

const emit = defineEmits<{
  open: [item: DoubanItem]
  more: [kind: DoubanKind]
}>()

/** 货架上最多几部 */
const SHELF_SIZE = 20
const SKELETON_COUNT = 7
const KIND_OPTIONS: SegmentedOption<DoubanKind>[] = [
  { value: 'movie', label: '电影' },
  { value: 'tv', label: '剧集' },
]

const kind = ref<DoubanKind>('movie')
const movie = useHotFeed('movie')
const tv = useHotFeed('tv')
const feed = computed(() => (kind.value === 'tv' ? tv : movie))

const kindLabel = computed(() => (kind.value === 'movie' ? '电影' : '剧集'))
const shelfItems = computed(() => feed.value.items.value.slice(0, SHELF_SIZE))
const pending = computed(() => {
  const status = feed.value.status.value
  return status === 'idle' || status === 'loading'
})
const alive = computed(() => {
  if (shelfItems.value.length || pending.value) return true
  const other = kind.value === 'tv' ? movie : tv
  const otherStatus = other.status.value
  return (
    other.items.value.length > 0 ||
    otherStatus === 'idle' ||
    otherStatus === 'loading'
  )
})

function subtitleOf(item: DoubanItem): string {
  return [item.year, item.type].filter(Boolean).join(' · ')
}

watch(
  kind,
  value => {
    const target = value === 'tv' ? tv : movie
    if (target.status.value === 'idle') void target.start()
  },
  { immediate: true }
)
</script>

<style scoped>
.hot-shelf-skeleton {
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-card);
  background: var(--bg-fill-secondary);
}
.hot-shelf :deep(.hot-empty) {
  flex: 1 1 100%;
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
