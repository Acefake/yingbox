<template>
  <div ref="root" class="db-browse">
    <header class="db-head">
      <UiIconButton
        icon="back"
        label="返回首页"
        variant="secondary"
        @click="emit('back')"
      />
      <h1 class="db-title">{{ title }}</h1>
      <UiSegmented
        v-if="target.type !== 'list'"
        label="电影或剧集"
        :model-value="query.kind"
        :options="KIND_OPTIONS"
        @update:model-value="kind => emit('kind', kind)"
      />
    </header>

    <!-- 片单是豆瓣快捷标签，和多维筛选互斥，所以片单页没有这一行 -->
    <div v-if="target.type !== 'list'" class="db-filters">
      <UiGlassSelect
        v-for="pill in pills"
        :key="pill.key"
        :model-value="pill.value"
        :options="pill.options"
        :label="pill.label"
        :text="pill.text"
        :active="pill.active"
        @update:model-value="
          value => feed.setQuery(filterPatch(pill.key, value))
        "
      />
      <span class="db-filters-gap" />
      <template v-if="chips.length">
        <UiChip
          v-for="chip in chips"
          :key="chip.key"
          class="db-chip"
          size="md"
          :aria-label="`去掉条件：${chip.label}`"
          @click="feed.setQuery(clearFilterPatch(chip.key))"
        >
          {{ chip.label }}<UiIcon name="close" size="sm" />
        </UiChip>
        <UiButton
          variant="plain"
          size="sm"
          label="清除"
          @click="feed.setQuery(CLEAR_ALL_PATCH)"
        />
      </template>
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
 * 首页的浏览页（热门全部 / 某个类型 / 某个精选片单）：返回 + 大标题 + 电影 / 剧集分段，
 * 下一行是 排序 / 地区 / 年代 / 评分 下拉胶囊（UiGlassSelect），右侧是已选条件 chip（点了去掉）和「清除」，
 * 下面是海报网格，滚到底自动取下一页（UiVirtualGrid 的 reach-end），失败可重试。
 * 桌面端电影卡右上角多一个「找 115 资源」，打开与 AI 助手共用的候选面板。
 *
 * 条件和列表在 use-douban-feed 的模块级单例里（会话级记住）：进入目标时按 nextBrowseQuery 换条件，
 * 同一页面再进来保留上次的筛选。在线页被 keep-alive 切走时记下滚动位置，回来恢复。
 * 切电影 / 剧集 emit kind（在线页改路由参数），返回 emit back。
 */
import UiButton from '@/components/ui/UiButton.vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiGlassSelect from '@/components/ui/UiGlassSelect.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import { listWaiting } from '@/components/ui/feedback'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from 'vue'

import type { DoubanKind } from '../../../../../shared/douban/query'
import { isFavorite, toggleFavorite } from '../composables/favorites'
import { useDoubanFeed } from '../composables/use-douban-feed'
import type { DoubanItem } from '../types'
import {
  CLEAR_ALL_PATCH,
  clearFilterPatch,
  filterChips,
  filterPatch,
  filterPills,
} from '../utils/browse-filters'
import {
  type BrowseTarget,
  browseTitle,
  nextBrowseQuery,
} from '../utils/browse-target'
import {
  doubanDiscoverReady,
  loadDoubanDiscover,
  openDoubanDiscover,
} from '../utils/douban-discover'
import { doubanPreviewSource } from '../utils/douban-preview'

const props = defineProps<{ target: BrowseTarget }>()
const emit = defineEmits<{
  open: [item: DoubanItem]
  kind: [kind: DoubanKind]
  back: []
}>()

const PAGE_SIZE = 16
const KIND_OPTIONS: Array<{ value: DoubanKind; label: string }> = [
  { value: 'movie', label: '电影' },
  { value: 'tv', label: '剧集' },
]

const feed = useDoubanFeed()
const { query, items, status, refreshing } = feed

const title = computed(() => browseTitle(props.target))
const pills = computed(() => filterPills(query.value))
const chips = computed(() => filterChips(query.value))

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
    if (scrollEl) scrollEl.scrollTop = feed.scrollTop
    tracking = true
  })
}

// 进入 / 切换目标：换条件时回到顶部；条件已合适（同一页面再进来）就沿用列表与滚动位置
watch(
  () => props.target,
  (target, prev) => {
    const next = nextBrowseQuery(target, query.value, prev)
    if (!next) return void feed.start()
    feed.scrollTop = 0
    if (scrollEl) scrollEl.scrollTop = 0
    void feed.replaceQuery(next)
  },
  { immediate: true }
)

onMounted(() => {
  scrollEl = root.value?.closest<HTMLElement>('.primary-scroll') ?? null
  scrollEl?.addEventListener('scroll', rememberScroll, { passive: true })
  restoreScroll()
  void loadDoubanDiscover()
})
onBeforeUnmount(() => scrollEl?.removeEventListener('scroll', rememberScroll))
onDeactivated(() => (tracking = false))
onActivated(restoreScroll)
</script>

<style scoped>
.db-browse {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.db-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
}
.db-title {
  margin: 0 var(--space-1) 0 0;
  overflow: hidden;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.db-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.db-filters-gap {
  flex: 1;
}
.db-chip {
  gap: var(--space-1_5);
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
