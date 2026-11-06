<template>
  <div class="av-page">
    <!-- 视图切换 + 浏览筛选 -->
    <header class="av-toolbar">
      <UiInput
        v-model="search.keyword.value"
        v-enter="submitSearch"
        class="av-search-input yb-glass"
        clearable
        aria-label="搜索 AV 资源"
        placeholder="搜索番号或关键词"
        @clear="clearSearch"
      >
        <template #trailing>
          <UiMenuButton
            :items="searchHistoryItems"
            icon="history"
            label="搜索历史"
            size="sm"
            icon-only
          />
          <UiIconButton icon="search" label="搜索" @click="submitSearch" />
        </template>
      </UiInput>
      <UiSegmented
        class="av-tabs yb-glass"
        :model-value="activeTab"
        :options="tabs"
        label="AV 视图"
        @update:model-value="activeTab = $event"
      />
      <AvBrowseFilters
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
      <ContinueRow section="av" :resume="playback.resumeContinue" />
      <UiSkeleton v-if="browse.loading.value" landscape />
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
              :title="video.vod_name ?? ''"
              :cover="coverSrc(video)"
              :subtitle="`${video.type_name || '未分类'} · ${video.vod_duration || '时长未知'}`"
              :favorite="isFav(video)"
              @open="playback.playVideo(video)"
              @toggle-favorite="toggleFav(video)"
            >
              <template #actions>
                <AvPlaylistButton @press="openPlaylistPicker(video)" />
                <AvWatchLaterButton
                  :saved="isWatchLater(video)"
                  @toggle="toggleWatchLater(video)"
                />
              </template>
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
      @play="playback.playSources"
      @toggle-favorite="toggleFav"
      @retry="search.search"
    >
      <template #actions="{ video }">
        <AvPlaylistButton @press="openPlaylistPicker(video)" />
        <AvWatchLaterButton
          :saved="isWatchLater(video)"
          @toggle="toggleWatchLater(video)"
        />
      </template>
    </AvSearchResults>

    <!-- 收藏 -->
    <AvFavoritesView
      v-if="activeTab === 'favorites'"
      class="av-scroll primary-scroll"
      :favorites="favorites"
      @play="playback.playVideo"
      @toggle-favorite="toggleFav"
      @clear="favorites = []"
    >
      <template #actions="{ video }">
        <AvPlaylistButton @press="openPlaylistPicker(video)" />
        <AvWatchLaterButton
          :saved="isWatchLater(video)"
          @toggle="toggleWatchLater(video)"
        />
      </template>
    </AvFavoritesView>

    <AvWatchLaterView
      v-if="activeTab === 'watch-later'"
      class="av-scroll primary-scroll"
      :items="watchLater"
      :is-favorite="isFav"
      @play="playback.playVideo"
      @toggle-favorite="toggleFav"
    >
      <template #actions="{ video }">
        <AvPlaylistButton @press="openPlaylistPicker(video)" />
        <AvWatchLaterButton saved @toggle="toggleWatchLater(video)" />
      </template>
    </AvWatchLaterView>

    <AvPlaylistsView
      v-if="activeTab === 'playlists'"
      v-model:lists="playlists"
      v-model:pending="playlistVideo"
      v-model:selected-name="selectedPlaylistName"
      class="av-scroll primary-scroll"
      :is-favorite="isFav"
      @play="playback.playVideo"
      @toggle-favorite="toggleFav"
    >
      <template #actions="{ video }">
        <AvPlaylistButton @press="openPlaylistPicker(video)" />
        <AvWatchLaterButton
          :saved="isWatchLater(video)"
          @toggle="toggleWatchLater(video)"
        />
      </template>
    </AvPlaylistsView>

    <!-- 播放历史 -->
    <AvHistoryView
      v-if="activeTab === 'history'"
      class="av-scroll primary-scroll"
      :records="playback.playHistory.value"
      @resume="playback.resumeHistory"
      @clear="playback.playHistory.value = []"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * AV 页面：组合分类浏览、聚合搜索、收藏、待看、片单和播放历史。
 * 浏览 / 搜索 / 播放流程分别在 useAvBrowse、useAvSearch、useAvPlayback；
 * 纯规则在 ../utils，这里只做视图切换、收藏和把三者接起来。
 */
import PageHeader from '@/components/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiMenuButton from '@/components/ui/UiMenuButton.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import AvBrowseFilters from '../components/AvBrowseFilters.vue'
import StatusState from '@/components/StatusState.vue'
import { isIncognito } from '@/features/incognito'
import {
  type CatSpiderSite,
  loadCatSpiderSites,
  useOnlineSearch,
} from '@/features/online'
import { type AvTab, tabs } from './av-tabs'
import { useAvSearchHistory } from '../composables/use-av-search-history'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import { useRoute, useRouter } from 'vue-router'
import { ContinueRow } from '@/features/player'
import AvFavoritesView from '../components/AvFavoritesView.vue'
import AvHistoryView from '../components/AvHistoryView.vue'
import AvSearchResults from '../components/AvSearchResults.vue'
import AvPlaylistButton from '../components/AvPlaylistButton.vue'
import AvPlaylistsView from '../components/AvPlaylistsView.vue'
import AvWatchLaterButton from '../components/AvWatchLaterButton.vue'
import AvWatchLaterView from '../components/AvWatchLaterView.vue'
import { useAvBrowse } from '../composables/use-av-browse'
import { useAvPlayback } from '../composables/use-av-playback'
import { useAvSearch } from '../composables/use-av-search'
import { useAvSources } from '../composables/use-av-sources'
import { type AvVideo, buildAvEntries } from '../utils/av-catalog'
import { coverSrc } from '../utils/av-media'
import { toggleFavorite } from '../utils/av-playback'

const activeTab = useStorage<AvTab | 'downloads'>('av_active_tab', 'browse')
if (activeTab.value === 'downloads') activeTab.value = 'browse'
const route = useRoute()
const router = useRouter()
const ownPath = route.path
const routeKeyword = computed(() =>
  route.path === ownPath && typeof route.query.q === 'string'
    ? route.query.q.trim()
    : ''
)

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
const sourcesReady = loadCatSpiderSites()
let disposed = false

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
const playback = useAvPlayback()
let lastSearchQuery = ''
const { searchHistory, searchHistoryItems } = useAvSearchHistory(keyword => {
  search.keyword.value = keyword
  submitSearch()
})

const submitSearch = (): void => {
  const query = search.keyword.value.trim()
  if (!query) {
    clearSearch()
    return
  }
  activeTab.value = 'search'
  if (routeKeyword.value === query || lastSearchQuery === query)
    void runQuerySearch(query)
  if (routeKeyword.value !== query)
    void router.replace({ query: { ...route.query, q: query } })
}
const clearSearch = (): void => {
  lastSearchQuery = ''
  search.reset()
  if (activeTab.value === 'search') activeTab.value = 'browse'
  if (route.query.q) {
    void router.replace({ query: { ...route.query, q: undefined } })
  }
}

// ─── 收藏 ─────────────────────────────────────────────────────
const favorites = useStorage<AvVideo[]>('av_favorites', [])
const toggleFav = (video: AvVideo): void => {
  favorites.value = toggleFavorite(favorites.value, video)
}
const isFav = (video: AvVideo): boolean =>
  favorites.value.some(f => f._uid === video._uid)

const watchLater = useStorage<AvVideo[]>('av_watch_later', [])
const watchLaterIds = computed(
  () => new Set(watchLater.value.map(video => video._uid))
)
const isWatchLater = (video: AvVideo): boolean =>
  watchLaterIds.value.has(video._uid)
const toggleWatchLater = (video: AvVideo): void => {
  watchLater.value = toggleFavorite(watchLater.value, video)
}

const playlists = useStorage<{ name: string; items: AvVideo[] }[]>(
  'av_playlists',
  []
)
const playlistVideo = ref<AvVideo | null>(null)
const selectedPlaylistName = ref('')

function openPlaylistPicker(video: AvVideo): void {
  playlistVideo.value = video
  activeTab.value = 'playlists'
}

// ─── 路由 ?q= → 聚合搜索 ──────────────────────────────────────
const runQuerySearch = async (query: string): Promise<void> => {
  if (!query) return
  search.keyword.value = query
  activeTab.value = 'search'
  await sourcesReady
  if (
    disposed ||
    search.keyword.value.trim() !== query ||
    activeTab.value !== 'search'
  )
    return
  lastSearchQuery = query
  if (!isIncognito()) {
    searchHistory.value = [
      query,
      ...searchHistory.value.filter(keyword => keyword !== query),
    ].slice(0, 10)
  }
  void search.search()
}
watch(
  routeKeyword,
  query => {
    if (query === lastSearchQuery) return
    void runQuerySearch(query)
  },
  { immediate: true }
)

onMounted(async () => {
  window.addEventListener('app:navigate-back', playback.onNavigateBack)
  // 插件源清单来自后端，先加载完再决定当前数据源，避免误判为失效源。
  await sourcesReady
  catSpiderReady.value = true
  await browse.init()
})
onBeforeUnmount(() => {
  disposed = true
  browse.dispose()
  search.dispose()
  window.removeEventListener('app:navigate-back', playback.onNavigateBack)
})
</script>

<style scoped src="./av-view.css"></style>
