<template>
  <div ref="root" class="home-section">
    <!-- 与首页其它分区同一种分区标题；右侧切换与筛选同为 36px 的胶囊控件 -->
    <UiSectionHeader :title="query.kind === 'movie' ? '热门电影' : '热门剧集'">
      <UiSegmented
        label="电影或电视剧"
        :model-value="query.kind"
        :options="KIND_OPTIONS"
        @update:model-value="kind => feed.setQuery({ kind })"
      />
      <UiButton
        icon="filter"
        label="筛选"
        :pressed="panelOpen || filtersOn"
        :aria-expanded="panelOpen"
        @click="panelOpen = !panelOpen"
      />
    </UiSectionHeader>

    <!-- 默认一行快捷标签；动了多维筛选时快捷标签都不选中 -->
    <MediaFilterBar
      :rows="tagRows"
      :model-value="{ tag: query.tag }"
      @update:model-value="next => feed.setQuery({ tag: next.tag })"
    />
    <div v-if="panelOpen" class="db-filters">
      <MediaFilterBar
        :rows="filterRows"
        :model-value="filterValues"
        @update:model-value="applyFilters"
      />
      <UiButton
        v-if="filtersOn"
        class="db-clear"
        variant="plain"
        size="sm"
        label="清除筛选"
        @click="feed.setQuery({ tag: '热门' })"
      />
    </div>

    <!-- 首屏骨架；换条件时保留旧海报直到新一批到达（不塌高、不改滚动位置） -->
    <UiSkeleton v-if="waiting === 'skeleton'" :count="PAGE_SIZE" />
    <div v-else-if="status === 'error' && !items.length" class="db-state">
      <UiIcon name="warning" /> 豆瓣数据加载失败
      <UiButton size="sm" label="重试" @click="feed.retry" />
    </div>
    <template v-else>
      <UiVirtualGrid
        :items="items"
        class="ui-poster-grid"
        :class="{ 'is-refreshing': refreshing }"
        :aria-busy="waiting === 'more' || undefined"
        :item-key="item => item.url"
        @reach-end="feed.loadMore"
      >
        <template #default="{ item }">
          <UiPosterCard
            thumb
            :title="item.title"
            :cover="item.cover"
            :rating="item.rate"
            :subtitle="[item.year, item.type].filter(Boolean).join(' · ')"
            :favorite="isFavorite(item)"
            :preview="doubanPreviewSource(item)"
            @open="emit('open', item)"
            @toggle-favorite="toggleFavorite(item)"
          >
            <template v-if="doubanDiscoverReady && item.kind !== 'tv'" #actions>
              <UiIconButton
                icon="download"
                variant="overlay"
                size="sm"
                label="找 115 资源"
                @click.stop="openDoubanDiscover(item)"
              />
            </template>
          </UiPosterCard>
        </template>
      </UiVirtualGrid>
      <!-- 列表之后的状态行：加载下一页 / 下一页失败 / 到底 -->
      <div v-if="footer" class="db-state is-foot">
        <UiLoadingDots v-if="footer === 'loading'" label="正在加载更多" />
        <template v-else-if="footer === 'error'">
          加载失败
          <UiButton size="sm" label="重试" @click="feed.retry" />
        </template>
        <template v-else-if="footer === 'empty'">没有符合条件的影片</template>
        <template v-else>没有更多了</template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 在线首页的豆瓣区：电影 / 电视剧切换、一行快捷标签，「筛选」展开多维面板（类型、地区、年代、排序、评分下限）。
 * 列表滚到底自动取下一页（UiVirtualGrid 的 reach-end），失败可重试。
 * 桌面端电影卡右上角多一个「找 115 资源」，打开与 AI 助手共用的候选面板。
 * 状态在 use-douban-feed 的模块级单例里（会话级记住条件）；在线页被 keep-alive 切走时记下滚动位置，回来恢复。
 */
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import { listWaiting } from '@/components/ui/feedback'
import MediaFilterBar, {
  type MediaFilterRow,
} from '@/components/MediaFilterBar.vue'
import UiSectionHeader from '@/components/ui/UiSectionHeader.vue'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
} from 'vue'

import {
  type DoubanKind,
  type DoubanSort,
  GENRES,
  MIN_RATINGS,
  QUICK_TAGS,
  REGIONS,
  SORTS,
  eraOptions,
  hasFilters,
} from '../../../../../shared/douban/query'
import { useDoubanFeed } from '../composables/use-douban-feed'
import { isFavorite, toggleFavorite } from '../composables/favorites'
import type { DoubanItem } from '../types'
import {
  doubanDiscoverReady,
  loadDoubanDiscover,
  openDoubanDiscover,
} from '../utils/douban-discover'
import { doubanPreviewSource } from '../utils/douban-preview'

const emit = defineEmits<{ (e: 'open', item: DoubanItem): void }>()

const PAGE_SIZE = 16
const KIND_OPTIONS: Array<{ value: DoubanKind; label: string }> = [
  { value: 'movie', label: '电影' },
  { value: 'tv', label: '电视剧' },
]

const feed = useDoubanFeed()
const { query, items, status, refreshing } = feed

const filtersOn = computed(() => hasFilters(query.value))
const panelOpen = ref(filtersOn.value)

const pending = computed(
  () => status.value === 'loading' || status.value === 'idle'
)
const waiting = computed(() => listWaiting(pending.value, items.value.length))
/** 列表之后显示什么；换条件（refreshing）时只淡显旧卡，不在底部再提示 */
const footer = computed(() => {
  if (status.value === 'loading') return refreshing.value ? null : 'loading'
  if (status.value === 'error') return 'error'
  if (status.value === 'ended') return items.value.length ? 'end' : 'empty'
  return null
})

const option = (
  value: string,
  label = value
): MediaFilterRow['options'][0] => ({
  value,
  label,
})
const tagRows = computed<MediaFilterRow[]>(() => [
  {
    key: 'tag',
    label: '分类',
    options: QUICK_TAGS[query.value.kind].map(tag => option(tag)),
  },
])
const filterRows = computed<MediaFilterRow[]>(() => [
  {
    key: 'genre',
    label: '类型',
    options: [
      option('', '全部'),
      ...GENRES[query.value.kind].map(g => option(g)),
    ],
  },
  {
    key: 'region',
    label: '地区',
    options: [
      option('', '全部'),
      ...REGIONS[query.value.kind].map(r => option(r)),
    ],
  },
  {
    key: 'era',
    label: '年代',
    options: [
      option('', '全部'),
      ...eraOptions(new Date().getFullYear()).map(e => option(e)),
    ],
  },
  {
    key: 'sort',
    label: '排序',
    options: SORTS.map(s => option(s.value, s.label)),
  },
  {
    key: 'rating',
    label: '评分',
    options: MIN_RATINGS.map(n =>
      option(String(n), n ? `${n} 分以上` : '不限')
    ),
  },
])
const filterValues = computed(() => ({
  genre: query.value.genre,
  region: query.value.region,
  era: query.value.era,
  sort: query.value.sort,
  rating: String(query.value.minRating),
}))
const applyFilters = (next: Record<string, string>): void => {
  void feed.setQuery({
    genre: next.genre,
    region: next.region,
    era: next.era,
    sort: next.sort as DoubanSort,
    minRating: Number(next.rating),
  })
}

/*
 * 滚动位置：在线页的滚动容器（OnlineView 的 .primary-scroll）被 keep-alive 切走时整块离开文档，
 * 回来时 scrollTop 已归零，切走那一刻也读不到（停用钩子在 DOM 移走之后才调）。
 * 所以滚动时随手记进 feed，停用期间不记，切回 / 重新挂载时写回。
 */
const root = ref<HTMLElement | null>(null)
let scrollEl: HTMLElement | null = null
let tracking = true
const rememberScroll = (): void => {
  if (tracking && scrollEl) feed.scrollTop = scrollEl.scrollTop
}
const restoreScroll = (): void => {
  void nextTick(() => {
    if (scrollEl && feed.scrollTop) scrollEl.scrollTop = feed.scrollTop
    tracking = true
  })
}
onMounted(() => {
  scrollEl = root.value?.closest<HTMLElement>('.primary-scroll') ?? null
  scrollEl?.addEventListener('scroll', rememberScroll, { passive: true })
  restoreScroll()
  void feed.start()
  void loadDoubanDiscover()
})
onBeforeUnmount(() => scrollEl?.removeEventListener('scroll', rememberScroll))
onDeactivated(() => (tracking = false))
onActivated(restoreScroll)
</script>

<style scoped>
.home-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.db-filters {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

.ui-poster-grid.is-refreshing {
  opacity: 0.6;
  transition: opacity var(--duration-fast) ease;
}

.db-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-7);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
.db-state.is-foot {
  padding: var(--space-4) 0;
}
</style>
