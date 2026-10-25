<template>
  <div class="vod-browse">
    <div class="vod-header">
      <PageHeader title="媒体库" :count="filteredCards.length">
        <template #status
          ><UiLoadingDots v-if="loadingSources" label="正在加载源"
        /></template>
        <template #actions
          ><UiIconButton
            icon="refresh"
            label="刷新媒体库"
            :loading="loading"
            :disabled="loadingSources"
            @click="refreshCurrent"
        /></template>
      </PageHeader>
      <MediaFilterBar
        :rows="filterRows"
        :model-value="filters"
        @update:model-value="handleFilterUpdate"
      />
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="ui-error-state">
      <p>{{ error }}</p>
      <UiButton icon="refresh" label="重新加载" @click="retry" />
    </div>

    <!-- 空状态 -->
    <StatusState
      v-if="!loading && !error && !filteredCards.length && !loadingSources"
      icon="play"
      :title="
        sources.length
          ? '暂无内容'
          : '无法加载插件视频源，请检查插件源是否已安装并启用'
      "
    />

    <!-- 内容卡片网格 -->
    <UiVirtualGrid
      v-if="filteredCards.length"
      :items="filteredCards"
      class="ui-poster-grid"
      :item-key="card => card.vod_id + card._siteName"
    >
      <template #default="{ item: card }">
        <UiPosterCard
          thumb
          :title="card.vod_name"
          :cover="card.vod_pic"
          :subtitle="card.vod_remarks"
          @open="handleOpenCard(card)"
        >
          <template #badges
            ><span class="ui-poster-badge">{{ card._siteName }}</span></template
          >
        </UiPosterCard>
      </template>
    </UiVirtualGrid>

    <!-- 加载更多 -->
    <div v-if="filteredCards.length && hasMore" class="load-more">
      <UiButton
        :label="loading ? '加载中...' : '加载更多'"
        :loading="loading"
        @click="loadMore"
      />
    </div>

    <!-- 首次加载骨架 -->
    <UiSkeleton v-if="loading && !cards.length" :count="8" />
  </div>
</template>

<script setup lang="ts">
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusState from '@/components/StatusState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { computed, onMounted, ref } from 'vue'
import MediaFilterBar, {
  type MediaFilterRow,
} from '@/components/MediaFilterBar.vue'
import { type VodCard, useVodBrowse } from '../composables/use-vod-browse'
import { type CmsItem, useOnlineSearch } from '../composables/use-online-search'

const emit = defineEmits<{
  openItem: [item: CmsItem]
}>()

const { loadCatSpiderSites, activeCatSpiderSites } = useOnlineSearch()

const {
  sources,
  activeTabs,
  cards,
  loading,
  loadingSources,
  error,
  hasMore,
  loadSources,
  switchSource,
  switchTab,
  loadMore,
  reload,
  cardToCmsItem,
} = useVodBrowse()

const filters = ref<Record<string, string>>({
  source: 'all',
  category: 'all',
  status: 'all',
  progress: 'all',
  genre: 'all',
  region: 'all',
  year: 'all',
  type: 'all',
})
const filterRows = computed<MediaFilterRow[]>(() => [
  {
    key: 'type',
    label: '分类',
    options: [
      { label: '全部', value: 'all' },
      { label: '电影', value: '电影' },
      { label: '电视剧', value: '电视剧' },
      { label: '合集', value: '合集' },
    ],
  },
  ...(sources.value.length
    ? [
        {
          key: 'source',
          label: '来源',
          options: [
            { label: '全部', value: 'all' },
            ...sources.value.map((s, i) => ({
              label: s.site.name,
              value: String(i),
            })),
          ],
        },
      ]
    : []),
  ...(activeTabs.value.length
    ? [
        {
          key: 'category',
          label: '子分类',
          options: [
            { label: '全部', value: 'all' },
            ...activeTabs.value.map((t, i) => ({
              label: t.name,
              value: String(i),
            })),
          ],
        },
      ]
    : []),
  {
    key: 'status',
    label: '状态',
    options: [
      { label: '全部', value: 'all' },
      { label: 'NFO识别', value: 'nfo' },
      { label: 'TMDB识别', value: 'tmdb' },
      { label: '智能识别', value: 'smart' },
      { label: '未识别', value: 'unknown' },
    ],
  },
  {
    key: 'progress',
    label: '进度',
    options: [
      { label: '全部', value: 'all' },
      { label: '未观看', value: 'unwatched' },
      { label: '已观看', value: 'watched' },
    ],
  },
  {
    key: 'genre',
    label: '风格',
    options: [
      { label: '全部', value: 'all' },
      ...[
        '剧情',
        '喜剧',
        '动作',
        '爱情',
        '惊悚',
        '犯罪',
        '悬疑',
        '战争',
        '科幻',
        '动画',
        '恐怖',
        '家庭',
        '冒险',
        '奇幻',
        '历史',
        '纪录',
        '音乐',
        '西部',
        '其他',
      ].map(label => ({ label, value: label })),
    ],
  },
  {
    key: 'region',
    label: '地区',
    options: [
      { label: '全部', value: 'all' },
      ...[
        '中国大陆',
        '中国香港',
        '中国台湾',
        '美国',
        '英国',
        '法国',
        '德国',
        '意大利',
        '西班牙',
        '葡萄牙',
        '韩国',
        '日本',
        '印度',
        '泰国',
        '其他',
      ].map(label => ({ label, value: label })),
    ],
  },
  {
    key: 'year',
    label: '年份',
    options: [
      { label: '全部', value: 'all' },
      ...[
        '2026',
        '2025',
        '2024',
        '2023',
        '2022',
        '2021',
        '2020-2011',
        '2010-2001',
        '2000-1991',
        '1990-1981',
        '更早',
      ].map(label => ({ label, value: label })),
    ],
  },
])
const filteredCards = computed(() =>
  cards.value.filter(card => {
    const year = filters.value.year
    const type = filters.value.type
    const matchesYear =
      year === 'all' || (year.includes('-') ? true : card.vod_year === year)
    const typeName = card.type_name
    const activeTabName =
      activeTabs.value[Number(filters.value.category)]?.name || ''
    const matchesType =
      type === 'all' ||
      (type === '电视剧'
        ? /电视剧|剧集/.test(typeName || activeTabName)
        : typeName.includes(type) ||
          (!typeName && activeTabName.includes(type)))
    return matchesYear && matchesType
  })
)
const handleFilterUpdate = (next: Record<string, string>): void => {
  filters.value = next
  if (next.source !== 'all') switchSource(Number(next.source))
  if (next.category !== 'all' && next.type === 'all')
    switchTab(Number(next.category))
  if (next.type !== 'all') {
    const typeTabIndex = activeTabs.value.findIndex(tab =>
      next.type === '电视剧'
        ? /电视剧|剧集/.test(tab.name)
        : tab.name.includes(next.type)
    )
    if (typeTabIndex >= 0) {
      filters.value = { ...filters.value, category: String(typeTabIndex) }
      switchTab(typeTabIndex)
    }
  }
}

const handleOpenCard = (card: VodCard): void => {
  emit('openItem', cardToCmsItem(card))
}

const retry = async (): Promise<void> => {
  await loadCatSpiderSites()
  const sites = activeCatSpiderSites()
  if (sites.length) await loadSources(sites)
}

const refreshCurrent = (): void => {
  if (sources.value.length) reload()
  else void retry()
}

onMounted(() => {
  void retry()
})
</script>

<style scoped>
.vod-browse {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: 100%;
}

/* ── 头部：源选择 + 分类 ── */
.vod-header {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);

  padding-bottom: var(--space-6);

  border-bottom: 1px solid var(--border-subtle);
}

/* ── 加载更多 ── */
.load-more {
  display: flex;
  justify-content: center;
  padding: var(--space-2) 0 var(--space-4);
}
</style>
