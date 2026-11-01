<template>
  <UiShelf
    v-if="alive"
    class="hot-shelf"
    :title="`热门${kindLabel}`"
    kind="portrait"
    more
    :more-label="`浏览全部${kindLabel}`"
    list
    @more="emit('more', kind)"
  >
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
 * 首页的热门电影或热门剧集货架，各自加载并打开对应浏览页。
 * 海报左下角是评分角标，海报下是片名和「年份 · 类型」。标题的 › 打开对应的浏览页。
 * 当前类还在取时显示占位；取完且为空时不渲染这一排。
 */
import { computed } from 'vue'

import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiRatingBadge from '@/components/ui/UiRatingBadge.vue'
import UiShelf from '@/components/ui/UiShelf.vue'

import type { DoubanKind } from '../../../../../shared/douban/query'
import { isFavorite, toggleFavorite } from '../composables/favorites'
import { useHotFeed } from '../composables/use-home-browse'
import type { DoubanItem } from '../types'
import { doubanPreviewSource } from '../utils/douban-preview'

const props = defineProps<{ kind: DoubanKind }>()
const emit = defineEmits<{
  open: [item: DoubanItem]
  more: [kind: DoubanKind]
}>()

/** 货架上最多几部 */
const SHELF_SIZE = 20
const SKELETON_COUNT = 7
const feed = useHotFeed(props.kind)
const kindLabel = computed(() => (props.kind === 'movie' ? '电影' : '剧集'))
const shelfItems = computed(() => feed.items.value.slice(0, SHELF_SIZE))
const pending = computed(() => {
  const status = feed.status.value
  return status === 'idle' || status === 'loading'
})
const alive = computed(() => shelfItems.value.length > 0 || pending.value)

function subtitleOf(item: DoubanItem): string {
  return [item.year, item.type].filter(Boolean).join(' · ')
}

void feed.start()
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
