<template>
  <UiShelf
    v-if="items.length || pending"
    class="db-shelf"
    :title="title"
    kind="portrait"
    more
    more-label="查看全部并筛选"
    list
    @more="emit('expand')"
  >
    <template #actions>
      <UiSegmented
        label="电影或剧集"
        :model-value="query.kind"
        :options="KIND_OPTIONS"
        @update:model-value="kind => feed.setQuery({ kind })"
      />
      <UiButton icon="filter" label="筛选" @click="emit('expand')" />
    </template>
    <template v-if="items.length">
      <UiPosterCard
        v-for="item in shelfItems"
        :key="item.url"
        role="listitem"
        thumb
        :title="item.title"
        :cover="item.cover"
        :rating="item.rate"
        :subtitle="[item.year, item.type].filter(Boolean).join(' · ')"
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
        class="db-shelf-skeleton"
        aria-hidden="true"
      />
    </template>
  </UiShelf>
</template>

<script setup lang="ts">
/**
 * 首页的热门电影 / 剧集货架：一排竖版海报（豆瓣浏览当前条件的前 20 部），右侧 电影 / 剧集 分段与「筛选」。
 * 标题的 › 或「筛选」emit expand，在线页换成完整网格（DoubanSection：快捷标签、多维筛选、滚到底翻页）。
 * 与完整网格共用 use-douban-feed 的模块级单例，换分段、切回来都不重取。首屏没到时显示占位，失败且为空时整排不渲染。
 */
import { computed, onMounted } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiShelf from '@/components/ui/UiShelf.vue'

import { type DoubanKind, hasFilters } from '../../../../../shared/douban/query'
import { isFavorite, toggleFavorite } from '../composables/favorites'
import { useDoubanFeed } from '../composables/use-douban-feed'
import type { DoubanItem } from '../types'
import { doubanPreviewSource } from '../utils/douban-preview'

const emit = defineEmits<{ open: [item: DoubanItem]; expand: [] }>()

/** 货架上最多几部 */
const SHELF_SIZE = 20
const SKELETON_COUNT = 7
const KIND_OPTIONS: Array<{ value: DoubanKind; label: string }> = [
  { value: 'movie', label: '电影' },
  { value: 'tv', label: '剧集' },
]

const feed = useDoubanFeed()
const { query, items, status } = feed
/** 标题跟着当前条件：热门电影 / 科幻 · 电影 / 筛选的电影 */
const title = computed(() => {
  const kind = query.value.kind === 'movie' ? '电影' : '剧集'
  if (hasFilters(query.value)) return `筛选的${kind}`
  const tag = query.value.tag
  return !tag || tag === '热门' ? `热门${kind}` : `${tag} · ${kind}`
})
const shelfItems = computed(() => items.value.slice(0, SHELF_SIZE))
const pending = computed(
  () => status.value === 'idle' || status.value === 'loading'
)

onMounted(() => void feed.start())
</script>

<style scoped>
.db-shelf-skeleton {
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-card);
  background: var(--bg-fill-secondary);
}
</style>
