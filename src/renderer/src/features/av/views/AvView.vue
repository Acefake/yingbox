<template>
  <div class="av-page">
    <!-- 视图切换 + 浏览筛选 -->
    <header class="av-toolbar">
      <UiSegmented
        :model-value="activeTab"
        :options="tabs"
        label="AV 视图"
        @update:model-value="activeTab = $event"
      />
      <MediaFilterBar
        v-if="activeTab === 'browse'"
        :rows="browse.filterRows.value"
        :model-value="browse.filterModel.value"
        @update:model-value="browse.onFilterChange"
      />
    </header>

    <!-- 分类浏览 -->
    <div
      v-if="activeTab === 'browse'"
      :ref="el => (browse.scrollEl.value = el as HTMLElement | null)"
      class="av-scroll primary-scroll"
      @scroll="browse.onScroll"
    >
      <AvSkeletonGrid v-if="browse.loading.value" />
      <StatusState
        v-else-if="browse.error.value"
        :title="browse.error.value"
        tone="danger"
      >
        <UiButton icon="refresh" label="重新加载" @click="browse.load()" />
      </StatusState>
      <template v-else>
        <PageHeader :title="browse.categoryName.value" as="h2">
          <template #status>
            <p class="yb-section-subtitle">
              {{ browse.currentEntry.value?.name || '未选择数据源' }} · 已加载
              {{ browse.videos.value.length }} 条<span
                v-if="browse.total.value"
              >
                · 共 {{ browse.total.value.toLocaleString() }} 条</span
              >
            </p>
          </template>
          <template #actions>
            <UiIconButton
              icon="refresh"
              label="刷新"
              @click="browse.load(true)"
            />
          </template>
        </PageHeader>
        <UiVirtualGrid
          v-if="browse.sortedVideos.value.length"
          :items="browse.sortedVideos.value"
          class="ui-poster-grid is-landscape"
          :item-key="video => `${video._source}-${video.vod_id}`"
        >
          <template #default="{ item: video }">
            <UiPosterCard
              thumb
              shape="landscape"
              :title="video.vod_name"
              :cover="coverSrc(video)"
              :subtitle="`${video.type_name || '未分类'} · ${video.vod_duration || '时长未知'}`"
              :favorite="isFav(video)"
              @open="playback.playVideo(video)"
              @toggle-favorite="toggleFav(video)"
            >
              <template v-if="video.vod_remarks" #badges>
                <span class="ui-poster-badge">{{ video.vod_remarks }}</span>
              </template>
            </UiPosterCard>
          </template>
        </UiVirtualGrid>
        <StatusState v-else title="这个分类暂时没有内容" />
        <div class="av-load-more" role="status" aria-live="polite">
          <span v-if="browse.loadingMore.value">正在加载更多…</span>
          <template v-else-if="browse.moreError.value">
            <span>{{ browse.moreError.value }}</span>
            <UiButton
              icon="refresh"
              label="重试"
              size="sm"
              @click="browse.load(false, true)"
            />
          </template>
          <span v-else-if="browse.videos.value.length && !browse.hasMore.value"
            >已全部加载</span
          >
        </div>
      </template>
    </div>

    <!-- 聚合搜索 -->
    <AvSearchResults
      v-if="activeTab === 'search'"
      class="av-scroll primary-scroll"
      :loading="search.loading.value"
      :has-searched="search.hasSearched.value"
      :error="search.error.value"
      :groups="search.groups.value"
      :done-count="search.doneCount.value"
      :source-count="search.sourceCount.value"
      :cms-source-count="activeSources.length"
      :can-retry="!!search.keyword.value.trim()"
      :is-favorite="isFav"
      @play="playback.playVideo"
      @toggle-favorite="toggleFav"
      @retry="search.search"
    />

    <!-- 收藏 -->
    <AvFavoritesView
      v-if="activeTab === 'favorites'"
      class="av-scroll primary-scroll"
      :favorites="favorites"
      @play="playback.playVideo"
      @toggle-favorite="toggleFav"
      @clear="favorites = []"
    />

    <!-- 播放历史 -->
    <AvHistoryView
      v-if="activeTab === 'history'"
      class="av-scroll primary-scroll"
      :records="playback.playHistory.value"
      @resume="playback.resumeHistory"
      @clear="playback.playHistory.value = []"
    />

    <!-- 下载 -->
    <DownloadsView
      v-if="activeTab === 'downloads'"
      class="av-scroll primary-scroll"
    />

    <!-- 播放器（非 Electron 兜底） -->
    <AvPlayerOverlay
      :show="playback.showPlayer.value"
      :message="playback.playerMessage.value"
      :src="playback.playingUrl.value"
      :poster="coverSrc(playback.playingVideo.value)"
      :title="playback.playingVideo.value?.vod_name || '正在播放'"
      @ready="playback.onPlayerReady"
      @loadedmetadata="playback.onLoadedMetadata"
      @timeupdate="playback.onTimeUpdate"
      @volumechange="playback.onVolumeChange"
      @error="playback.tryNextSource"
      @ended="playback.onEnded"
      @keydown="playback.onKeydown"
      @close="playback.closePlayer"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * AV 页面：分类浏览、聚合搜索、收藏、播放历史和下载五个视图的组合层。
 * 浏览 / 搜索 / 播放流程分别在 useAvBrowse、useAvSearch、useAvPlayback；
 * 纯规则在 ../utils，这里只做视图切换、收藏和把三者接起来。
 */
import PageHeader from '@/components/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import UiSegmented, {
  type SegmentedOption,
} from '@/components/ui/UiSegmented.vue'
import MediaFilterBar from '@/components/MediaFilterBar.vue'
import StatusState from '@/components/StatusState.vue'
import { DownloadsView } from '@/features/download'
import {
  type CatSpiderSite,
  loadCatSpiderSites,
  useOnlineSearch,
} from '@/features/online'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import { useRoute } from 'vue-router'
import AvFavoritesView from '../components/AvFavoritesView.vue'
import AvHistoryView from '../components/AvHistoryView.vue'
import AvPlayerOverlay from '../components/AvPlayerOverlay.vue'
import AvSearchResults from '../components/AvSearchResults.vue'
import AvSkeletonGrid from '../components/AvSkeletonGrid.vue'
import { useAvBrowse } from '../composables/use-av-browse'
import { useAvPlayback } from '../composables/use-av-playback'
import { useAvSearch } from '../composables/use-av-search'
import { useAvSources } from '../composables/use-av-sources'
import { buildAvEntries } from '../utils/av-catalog'
import { coverSrc } from '../utils/av-media'
import { toggleFavorite } from '../utils/av-playback'

type AvTab = 'browse' | 'search' | 'favorites' | 'history' | 'downloads'
/** 「搜索」视图没有 Tab，由路由 ?q= 进入。 */
const tabs: SegmentedOption<AvTab>[] = [
  { value: 'browse', label: '浏览' },
  { value: 'favorites', label: '收藏' },
  { value: 'history', label: '播放历史' },
  { value: 'downloads', label: '下载' },
]
const activeTab = useStorage<AvTab>('av_active_tab', 'browse')
const route = useRoute()

// ─── 站点（AV CMS 源 + 成人插件源） ───────────────────────────
const { getActiveSources, activeSources } = useAvSources()
const { CATSPIDER_SITES, selectedCatSpider, isAdultCatSpiderSite } =
  useOnlineSearch()
// 启用的成人插件源：与在线搜索共用同一份启用列表
const pluginAvSources = computed<CatSpiderSite[]>(() =>
  CATSPIDER_SITES.value.filter(
    site =>
      isAdultCatSpiderSite(site) && selectedCatSpider.value.includes(site.api)
  )
)
const avEntries = computed(() =>
  buildAvEntries(activeSources.value, pluginAvSources.value)
)
const catSpiderReady = ref(false)

const browse = useAvBrowse({
  entries: avEntries,
  isActive: () => activeTab.value === 'browse',
  ready: catSpiderReady,
})
const search = useAvSearch({
  cmsSources: getActiveSources,
  pluginSources: pluginAvSources,
  cmsCount: () => activeSources.value.length,
})
const playback = useAvPlayback({
  findGroup: search.findGroup,
  upNext: () =>
    activeTab.value === 'search'
      ? search.groups.value
      : activeTab.value === 'browse'
        ? browse.sortedVideos.value.map(video => ({ items: [video] }))
        : [],
})

// ─── 收藏 ─────────────────────────────────────────────────────
const favorites = useStorage<any[]>('av_favorites', [])
const toggleFav = (video: any) => {
  favorites.value = toggleFavorite(favorites.value, video)
}
const isFav = (video: any) =>
  favorites.value.some((f: any) => f._uid === video._uid)

// ─── 路由 ?q= → 聚合搜索 ──────────────────────────────────────
const runQuerySearch = () => {
  const query = String(route.query.q || '').trim()
  if (!query) return search.reset()
  search.keyword.value = query
  activeTab.value = 'search'
  void search.search()
}
watch(() => route.query.q, runQuerySearch, { immediate: true })

onMounted(async () => {
  window.addEventListener('app:navigate-back', playback.onNavigateBack)
  // 插件源清单来自后端，先加载完再决定当前数据源，避免误判为失效源。
  await loadCatSpiderSites()
  catSpiderReady.value = true
  await browse.init()
  if (route.query.tab === 'search') runQuerySearch()
})
onBeforeUnmount(() => {
  browse.dispose()
  search.dispose()
  window.removeEventListener('app:navigate-back', playback.onNavigateBack)
})
</script>

<style scoped>
.av-page {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-content);
  color: var(--text-primary);
}
.av-toolbar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6) var(--space-3);
}
.av-toolbar > .ui-segmented {
  align-self: flex-start;
}
.av-scroll {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-6);
  overflow-y: auto;
  padding: var(--space-3) var(--space-6) var(--space-8);
}
.av-load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-height: var(--control-height);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
