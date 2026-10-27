<template>
  <UiShelf
    v-if="items.length || pending"
    class="hot-shelf"
    :title="title"
    kind="portrait"
    more
    :more-label="`浏览全部${kindLabel}`"
    list
    @more="emit('more')"
  >
    <template v-if="items.length">
      <UiPosterCard
        v-for="item in shelfItems"
        :key="item.url"
        role="listitem"
        thumb
        :title="item.title"
        :cover="item.cover"
        :subtitle="ratingText(item)"
        :favorite="isFavorite(item)"
        :preview="doubanPreviewSource(item)"
        @open="emit('open', item)"
        @toggle-favorite="toggleFavorite(item)"
      />
    </template>
    <template v-else>
      <span
        v-for="n in SKELETON_COUNT"
        :key="n"
        class="hot-shelf-skeleton"
        aria-hidden="true"
      />
    </template>
  </UiShelf>
</template>

<script setup lang="ts">
/**
 * 首页的「热门电影」/「热门剧集」货架：一排竖版海报（豆瓣热门第一页的前 20 部），海报下是片名和「豆瓣 8.8」。
 * 标题的 › emit more，在线页打开浏览页（类型 = 全部，对应电影或剧集）。
 * 数据是 use-home-browse 里该分类独立的一份，回首页不重取。首屏没到时显示占位，失败且为空时整排不渲染。
 */
import { computed, onMounted } from 'vue'

import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiShelf from '@/components/ui/UiShelf.vue'

import type { DoubanKind } from '../../../../../shared/douban/query'
import { isFavorite, toggleFavorite } from '../composables/favorites'
import { useHotFeed } from '../composables/use-home-browse'
import type { DoubanItem } from '../types'
import { doubanPreviewSource } from '../utils/douban-preview'

const props = defineProps<{ kind: DoubanKind }>()
const emit = defineEmits<{ open: [item: DoubanItem]; more: [] }>()

/** 货架上最多几部 */
const SHELF_SIZE = 20
const SKELETON_COUNT = 7

const feed = useHotFeed(props.kind)
const { items, status } = feed
const kindLabel = computed(() => (props.kind === 'movie' ? '电影' : '剧集'))
const title = computed(() => `热门${kindLabel.value}`)
const shelfItems = computed(() => items.value.slice(0, SHELF_SIZE))
const pending = computed(
  () => status.value === 'idle' || status.value === 'loading'
)
/** 海报下的一行：「豆瓣 8.8」，没有评分时不写 */
const ratingText = (item: DoubanItem): string =>
  /^\d/.test(item.rate) ? `豆瓣 ${item.rate}` : ''

onMounted(() => void feed.start())
</script>

<style scoped>
.hot-shelf-skeleton {
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-card);
  background: var(--bg-fill-secondary);
}
</style>
