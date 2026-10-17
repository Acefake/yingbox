<template>
  <div class="av-page h-full overflow-hidden flex flex-col">
    <!-- Tab 导航 + 搜索栏 -->
    <div class="flex-shrink-0 bg-transparent">
      <MissavPlayEntry @play="playMissavStream" />
      <!-- Tab 行 -->
      <div class="flex items-center gap-2 px-4 pt-3 pb-0">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="h-10 px-4 rounded-full text-[14px] transition-colors"
          :class="activeTab === tab.id ? 'av-tab is-active' : 'av-tab'"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
      <!-- 浏览工具栏 -->
      <div v-if="activeTab === 'browse'" class="px-4 py-3">
        <MediaFilterBar
          :rows="avFilterRows"
          :model-value="avFilterModel"
          @update:model-value="onFilterChange"
        />
      </div>
    </div>

    <!-- 分类浏览内容 -->
    <div
      v-if="activeTab === 'browse'"
      ref="browseScroll"
      class="primary-scroll flex-1 overflow-y-auto p-6"
      @scroll="onBrowseScroll"
    >
      <div
        v-if="browseLoading"
        class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
      >
        <div
          v-for="i in 12"
          :key="i"
          class="animate-pulse overflow-hidden rounded-lg av-card"
        >
          <div class="aspect-video av-skel" />
          <div class="space-y-2 p-3">
            <div class="h-3 w-4/5 rounded av-skel-line" />
            <div class="h-3 w-2/5 rounded av-skel-line" />
          </div>
        </div>
      </div>
      <div
        v-else-if="browseError"
        class="flex min-h-60 flex-col items-center justify-center gap-3 text-center"
      >
        <p class="text-sm" style="color: var(--danger)">{{ browseError }}</p>
        <button
          class="h-10 rounded-lg av-ghost-btn px-4 text-sm"
          @click="loadBrowse()"
        >
          重新加载
        </button>
      </div>
      <template v-else>
        <div class="mb-4 flex items-center justify-between">
          <div>
            <PageTitle as="h2">
              {{ currentBrowseCategoryName }}
            </PageTitle>
            <p class="yb-section-subtitle">
              {{ currentBrowseSource?.name || '未选择数据源' }} · 已加载 {{ browseVideos.length }} 条<span
                v-if="browseTotal"
              >
                · 共 {{ browseTotal.toLocaleString() }} 条</span
              >
            </p>
          </div>
          <button
            class="h-9 rounded-lg px-3 text-xs av-ghost-btn"
            @click="loadBrowse(true)"
          >
            刷新
          </button>
        </div>
        <div
          v-if="sortedBrowseVideos.length"
          class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
        >
          <div
            v-for="video in sortedBrowseVideos"
            :key="`${video._source}-${video.vod_id}`"
            class="group cursor-pointer overflow-hidden rounded-lg av-card transition-colors"
            @click="playVideo(video)"
          >
            <div class="relative aspect-video overflow-hidden bg-black">
              <img
                :src="video.vod_pic"
                :alt="video.vod_name"
                class="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
                loading="lazy"
                decoding="async"
                @error="handleImageError"
              /><span
                v-if="video.vod_remarks"
                class="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px]"
                >{{ video.vod_remarks }}</span
              ><button
                class="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-lg"
                :class="
                  isFav(video)
                    ? 'text-yellow-400'
                    : 'text-white/70 hover:text-yellow-300'
                "
                @click.stop="toggleFav(video)"
              >
                {{ isFav(video) ? '♥' : '♡' }}
              </button>
            </div>
            <div class="p-3">
              <h3
                class="line-clamp-2 min-h-10 text-sm font-medium leading-5 av-card-title"
              >
                {{ video.vod_name }}
              </h3>
              <p class="mt-2 truncate text-xs yb-dim">
                {{ video.type_name || '未分类' }} ·
                {{ video.vod_duration || '时长未知' }}
              </p>
            </div>
          </div>
        </div>
        <div
          v-else
          class="flex min-h-60 items-center justify-center text-sm yb-dim"
        >
          这个分类暂时没有内容
        </div>
        <div class="mt-6 flex items-center justify-center gap-3 text-sm yb-muted" role="status" aria-live="polite">
          <span v-if="browseLoadingMore">正在加载更多…</span>
          <template v-else-if="browseMoreError"><span>{{ browseMoreError }}</span><button type="button" class="av-ghost-btn" @click="loadBrowse(false, true)">重试</button></template>
          <span v-else-if="browseVideos.length && !browseHasMore">已全部加载</span>
        </div>
      </template>
    </div>

    <!-- 聚合搜索内容 -->
    <div
      v-if="activeTab === 'search'"
      class="primary-scroll flex-1 overflow-y-auto p-6"
    >
      <!-- 加载进度 -->
      <div
        v-if="loading"
        class="flex flex-col items-center justify-center py-8 gap-3"
      >
        <div
          class="animate-spin rounded-full h-8 w-8 border-b-2"
          style="border-color: var(--accent)"
        ></div>
        <p class="text-sm yb-muted">
          正在聚合 {{ searchSourceCount }} 个站点... ({{ doneCount }}/{{
            searchSourceCount
          }})
        </p>
        <div class="w-64 av-skel rounded-full h-1.5">
          <div
            class="av-progress h-1.5 rounded-full transition-all"
            :style="{ width: `${(doneCount / activeSources.length) * 100}%` }"
          ></div>
        </div>
      </div>
      <div
        v-if="loading && mergedVideos.length === 0"
        class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
      >
        <div
          v-for="i in 12"
          :key="i"
          class="animate-pulse overflow-hidden rounded-lg av-card"
        >
          <div class="aspect-video av-skel" />
          <div class="space-y-2 p-3">
            <div class="h-3 w-4/5 rounded av-skel-line" />
            <div class="h-3 w-2/5 rounded av-skel-line" />
          </div>
        </div>
      </div>
      <div
        v-if="searchError"
        class="flex min-h-52 flex-col items-center justify-center gap-3 text-center"
      >
        <p class="text-sm" style="color: var(--danger)">{{ searchError }}</p>
        <button
          v-if="searchKeyword.trim()"
          class="h-10 rounded-lg av-ghost-btn px-4 text-sm"
          @click="handleSearch"
        >
          重试搜索
        </button>
      </div>
      <!-- 合并结果网格 -->
      <div
        v-if="mergedVideos.length > 0"
        class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
        :class="{ 'mt-4': loading }"
      >
        <div
          v-for="group in mergedVideos"
          :key="group.key"
          class="group cursor-pointer overflow-hidden rounded-lg av-card transition-colors"
          @click="playVideo(group.items[0])"
        >
          <div
            class="relative overflow-hidden av-skel"
            style="aspect-ratio: 16/9"
          >
            <img
              :src="group.vod_pic"
              :alt="group.vod_name"
              class="w-full h-full object-contain bg-black"
              loading="lazy"
              decoding="async"
              @error="handleImageError"
            />
            <div
              class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center"
            >
              <div
                class="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <svg
                  class="w-5 h-5 text-white ml-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    d="M6.3 5.84a.75.75 0 011.06.02l3.858 4.5a.75.75 0 010 .98l-3.858 4.5A.75.75 0 016 14.5V5.75a.75.75 0 01.3-.91z"
                  />
                </svg>
              </div>
            </div>
            <div
              v-if="group.items[0].vod_remarks"
              class="absolute bottom-1 right-1 bg-black/60 px-1.5 py-0.5 rounded text-[10px] text-white"
            >
              {{ group.items[0].vod_remarks }}
            </div>
            <button
              class="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-lg transition-colors"
              :class="
                isFav(group.items[0])
                  ? 'text-yellow-400'
                  : 'text-white/70 hover:text-yellow-300'
              "
              @click.stop="toggleFav(group.items[0])"
            >
              {{ isFav(group.items[0]) ? '♥' : '♡' }}
            </button>
          </div>
          <div class="p-3">
            <h3
              class="line-clamp-2 min-h-10 text-sm font-medium leading-5 av-card-title"
            >
              {{ group.vod_name }}
            </h3>
            <p class="mt-2 truncate text-xs yb-dim">
              {{ group.items.length }} 个可用来源
            </p>
          </div>
        </div>
      </div>
      <!-- 无结果提示 -->
      <div
        v-if="
          !loading && !searchError && mergedVideos.length === 0 && hasSearched
        "
        class="flex min-h-52 flex-col items-center justify-center yb-muted"
      >
        <p class="text-sm">未找到相关结果</p>
      </div>
      <div
        v-if="!loading && !hasSearched"
        class="flex min-h-64 flex-col items-center justify-center text-center"
      >
        <p class="text-sm yb-muted">搜索全部启用数据源</p>
        <p class="mt-2 text-xs yb-dim">输入番号或关键词后按回车</p>
      </div>
    </div>

    <!-- 收藏 -->
    <div
      v-if="activeTab === 'favorites'"
      class="primary-scroll flex-1 overflow-y-auto p-6"
    >
      <div class="mb-5 flex items-center justify-between gap-3">
        <div>
          <PageTitle as="h2">收藏</PageTitle>
          <p class="yb-section-subtitle">AV 资源收藏</p>
        </div>
        <button
          v-if="favorites.length"
          class="h-9 rounded-lg px-3 text-xs av-ghost-btn"
          @click="favorites = []"
        >
          清空
        </button>
      </div>
      <div v-if="favorites.length">
        <div class="flex items-center gap-2 mb-4">
          <span class="text-sm yb-muted">共 {{ favorites.length }} 个收藏</span>
          <button
            class="ml-auto h-9 rounded-lg px-3 text-xs av-ghost-btn"
            @click="favorites = []"
          >
            清空全部
          </button>
        </div>
        <div
          class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
        >
          <div
            v-for="fav in favorites"
            :key="fav._uid"
            class="group cursor-pointer overflow-hidden rounded-lg av-card transition-colors"
            @click="playVideo(fav)"
          >
            <div class="relative aspect-video bg-black">
              <img
                :src="fav.vod_pic"
                loading="lazy"
                decoding="async"
                class="w-full h-full object-contain bg-black"
                @error="handleImageError"
              />
              <div
                class="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white/80"
              >
                {{ fav._source }}
              </div>
              <button
                class="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-lg text-yellow-400"
                @click.stop="toggleFav(fav)"
              >
                ♥
              </button>
            </div>
            <p
              class="line-clamp-2 min-h-16 p-3 text-sm font-medium leading-5 av-card-title"
            >
              {{ fav.vod_name }}
            </p>
          </div>
        </div>
      </div>
      <div
        v-else
        class="flex min-h-40 flex-col items-center justify-center yb-dim gap-2 rounded-xl border border-dashed av-empty-border"
      >
        <p class="text-4xl mb-2">♡</p>
        <p>还没有收藏</p>
        <p class="text-xs">在搜索结果中点击 ♡ 收藏</p>
      </div>
    </div>

    <!-- 播放历史 -->
    <div
      v-if="activeTab === 'history'"
      class="primary-scroll flex-1 overflow-y-auto p-6"
    >
      <div class="mb-5 flex items-center justify-between gap-3">
        <div>
          <PageTitle as="h2">播放历史</PageTitle>
          <p class="yb-section-subtitle">AV 资源播放记录</p>
        </div>
        <button
          v-if="playHistory.length"
          class="h-9 rounded-lg px-3 text-xs av-ghost-btn"
          @click="playHistory = []"
        >
          清空
        </button>
      </div>
      <div
        v-if="playHistory.length"
        class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3"
      >
        <div
          v-for="rec in playHistory"
          :key="rec.url"
          class="flex min-h-20 cursor-pointer items-center gap-3 rounded-lg av-card transition-all"
          @click="resumeHistory(rec)"
        >
          <img
            :src="rec.vod_pic"
            loading="lazy"
            decoding="async"
            class="h-14 w-20 flex-shrink-0 rounded-lg bg-black object-contain"
            @error="handleImageError"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm av-card-title truncate">{{ rec.vod_name }}</p>
            <p class="text-[11px] yb-dim">
              {{ rec.epName }} · {{ rec._source }}
            </p>
            <p class="text-[10px] yb-dim">{{ formatTime(rec.timestamp) }}</p>
            <div
              v-if="rec.duration > 0"
              class="mt-1.5 h-1 overflow-hidden rounded-full av-skel"
            >
              <div
                class="h-full rounded-full av-progress"
                :style="{
                  width: `${Math.min(100, (rec.progress / rec.duration) * 100)}%`,
                }"
              />
            </div>
          </div>
        </div>
      </div>
      <div
        v-else
        class="flex min-h-40 items-center justify-center text-sm yb-dim"
      >
        暂无播放记录
      </div>
    </div>

    <!-- 播放器：仅保留视频画面与原生控制条 -->
    <Transition name="sheet-fade">
      <div
        v-if="showPlayer"
        class="fixed inset-0 z-[2000] flex items-center justify-center bg-black/75"
        @click.self="closePlayer"
      >
        <div
          class="av-player-page relative flex h-[78vh] max-h-[92vh] w-[92vw] max-w-[1200px] items-center justify-center overflow-hidden rounded-xl bg-black"
        >
          <p
            v-if="playerMessage"
            class="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded bg-black/70 px-3 py-2 text-xs text-white/80"
          >
            {{ playerMessage }}
          </p>
          <UnifiedVideoPlayer
            :src="playingUrl"
            :poster="playingVideo?.vod_pic"
            :title="playingVideo?.vod_name || '正在播放'"
            closable
            @ready="onPlayerReady"
            @loadedmetadata="handleLoadedMetadata"
            @timeupdate="handleTimeUpdate"
            @volumechange="handleVolumeChange"
            @error="handleVideoError"
            @ended="handleVideoEnded"
            @keydown="handlePlayerKeydown"
            @close="closePlayer"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import PageTitle from '@/components/PageTitle.vue'
import MissavPlayEntry from './MissavPlayEntry.vue'
import { type MissavStream, resolveMissav } from '@/api/missav'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useStorage } from '@vueuse/core'
import { useRoute } from 'vue-router'
import { type AvSite, useAvSources } from './use-av-sources'
import { useVODParser } from '@/composables/use-vod-parser'
import {
  type CatSpiderSite,
  loadCatSpiderSites,
  useOnlineSearch,
} from '@/views/online/composables/use-online-search'
import MediaFilterBar, {
  type MediaFilterRow,
} from '@/components/MediaFilterBar.vue'
import UnifiedVideoPlayer from '@/components/UnifiedVideoPlayer.vue'
import {
  canOpenElectronPlayer,
  openMediaPlayer,
} from '@/composables/use-media-player'
import { getMediaProgress } from '@/utils/play-progress'
import { message } from 'ant-design-vue'

// ─── Tab ─────────────────────────────────────────────────────
const tabs = [
  { id: 'browse', label: '浏览' },
  { id: 'favorites', label: '收藏' },
  { id: 'history', label: '播放历史' },
] as const
type AvTab = 'browse' | 'search' | 'favorites' | 'history'
const activeTab = useStorage<AvTab>('av_active_tab', 'browse')
const route = useRoute()

// ─── 站点（AV CMS 源 + 成人插件源） ───────────────────────────
const { getActiveSources, activeSources } = useAvSources()
const {
  CATSPIDER_SITES,
  selectedCatSpider,
  isAdultCatSpiderSite,
  fetchDetail,
  resolvePlayUrl,
} = useOnlineSearch()
const { getConfig, getCards, search: vodSearch } = useVODParser()

type AvEntry = { api: string; name: string; kind: 'cms' | 'plugin' }
// 启用的成人插件源：与在线搜索共用同一份启用列表
const pluginAvSources = computed<CatSpiderSite[]>(() =>
  CATSPIDER_SITES.value.filter(
    site =>
      isAdultCatSpiderSite(site) && selectedCatSpider.value.includes(site.api)
  )
)
const avEntries = computed<AvEntry[]>(() => [
  ...activeSources.value.map(source => ({
    api: source.api,
    name: source.name,
    kind: 'cms' as const,
  })),
  ...pluginAvSources.value.map(site => ({
    api: site.api,
    name: site.name,
    kind: 'plugin' as const,
  })),
])

// ─── 单源分类浏览 ─────────────────────────────────────────────
type BrowseCategory = {
  id: number | null
  name: string
  ext?: Record<string, any>
}
type BrowseVisit = {
  categoryId: number | null
  categoryName: string
  sort: 'latest' | 'hot' | 'rating'
}
const browseSourceApi = useStorage('av_browse_source', '')
const browseCategoryId = ref<number | null>(null)
const browseCategoryName = ref('全部')
const browseCategories = ref<BrowseCategory[]>([{ id: null, name: '全部' }])
const avFilterRows = computed<MediaFilterRow[]>(() => [
  {
    key: 'source',
    label: '数据源',
    // 插件源排在前面，避免被一长串 CMS 源挤到看不见。
    options: [
      ...avEntries.value.filter(entry => entry.kind === 'plugin'),
      ...avEntries.value.filter(entry => entry.kind === 'cms'),
    ].map(entry => ({
      label: entry.kind === 'plugin' ? `${entry.name}（插件）` : entry.name,
      value: entry.api,
    })),
  },
  {
    key: 'sort',
    label: '排序',
    options: [
      { label: '最新发布', value: 'latest' },
      { label: '本周热度', value: 'hot' },
      { label: '评分优先', value: 'rating' },
    ],
  },
  {
    key: 'category',
    label: '分类',
    options: browseCategories.value.map(category => ({
      label: category.name,
      value: category.name,
    })),
  },
])
const avFilterModel = computed(() => ({
  source: browseSourceApi.value,
  sort: browseSort.value,
  category: browseCategoryName.value,
}))
const onFilterChange = (value: Record<string, string>) => {
  if (value.source && value.source !== browseSourceApi.value)
    browseSourceApi.value = value.source
  if (value.sort && value.sort !== browseSort.value)
    browseSort.value = value.sort as 'latest' | 'hot' | 'rating'
  if (value.category && value.category !== browseCategoryName.value) {
    const category = browseCategories.value.find(
      item => item.name === value.category
    )
    if (category) selectBrowseCategory(category)
  }
}
const browseVideos = shallowRef<any[]>([])
const browsePage = ref(1)
const browsePageCount = ref(0)
const browseTotal = ref(0)
const browseLoading = ref(false)
const browseError = ref('')
const browseLoadingMore = ref(false)
const browseMoreError = ref('')
const browseScroll = ref<HTMLElement | null>(null)
const browseHasMore = computed(() => browsePage.value < browsePageCount.value)
const onBrowseScroll = () => {
  const el = browseScroll.value
  if (activeTab.value !== 'browse' || !el || browseLoading.value || browseLoadingMore.value || browseMoreError.value || !browseHasMore.value) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) void loadBrowse(false, true)
}
const browseSort = ref<'latest' | 'hot' | 'rating'>('latest')
const browseVisits = useStorage<Record<string, BrowseVisit>>(
  'av_browse_visits',
  {}
)
const browseCategoryCache = useStorage<Record<string, BrowseCategory[]>>(
  'av_browse_categories',
  {}
)
type BrowseCacheEntry = {
  items: any[]
  pageCount: number
  total: number
  categories: BrowseCategory[]
}
const browseCache = new Map<string, BrowseCacheEntry>()
let browseAbort: AbortController | null = null
let activeBrowseKey = ''

const currentEntry = computed(() =>
  avEntries.value.find(entry => entry.api === browseSourceApi.value)
)
const currentBrowseSource = computed(() => currentEntry.value)
const isPluginSource = computed(() => currentEntry.value?.kind === 'plugin')
const currentBrowseCategoryName = computed(() => browseCategoryName.value)
const normalizeCategoryName = (name: unknown) => String(name ?? '').trim()
const sortedBrowseVideos = computed(() =>
  [...browseVideos.value].sort((a, b) => {
    if (browseSort.value === 'hot')
      return Number(b.vod_hits_week || 0) - Number(a.vod_hits_week || 0)
    if (browseSort.value === 'rating')
      return Number(b.vod_score || 0) - Number(a.vod_score || 0)
    return String(b.vod_time_add || b.vod_time || '').localeCompare(
      String(a.vod_time_add || a.vod_time || '')
    )
  })
)

const createBrowseUrl = (source: AvSite, page: number) => {
  const params = new URLSearchParams({ ac: 'detail', pg: String(page) })
  if (browseCategoryId.value !== null)
    params.set('t', String(browseCategoryId.value))
  return `${source.api}?${params}`
}

const mergeBrowseCategories = (items: any[]) => {
  const byId = new Map<number, BrowseCategory>(
    browseCategories.value
      .filter(
        (category): category is BrowseCategory & { id: number } =>
          category.id !== null
      )
      .map(category => [category.id, category])
  )
  for (const item of items) {
    const name = normalizeCategoryName(item.type_name)
    const id = Number(item.type_id)
    if (Number.isFinite(id) && name && !byId.has(id)) byId.set(id, { id, name })
  }
  browseCategories.value = [
    { id: null, name: '全部' },
    ...Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-CN')
    ),
  ]
  if (browseSourceApi.value)
    browseCategoryCache.value[browseSourceApi.value] = browseCategories.value
}

const saveBrowseVisit = () => {
  if (!browseSourceApi.value) return
  browseVisits.value[browseSourceApi.value] = {
    categoryId: browseCategoryId.value,
    categoryName: browseCategoryName.value,
    sort: browseSort.value,
  }
}

const restoreBrowseVisit = () => {
  const saved = browseVisits.value[browseSourceApi.value]
  browseCategories.value = browseCategoryCache.value[browseSourceApi.value] ?? [
    { id: null, name: '全部' },
  ]
  browseCategoryId.value = saved?.categoryId ?? null
  browseCategoryName.value = saved?.categoryName ?? '全部'
  browsePage.value = 1
  browseSort.value = saved?.sort ?? 'latest'
}

const browseCacheKey = (page: number) =>
  `${browseSourceApi.value}|${
    isPluginSource.value
      ? browseCategoryName.value
      : (browseCategoryId.value ?? 'all')
  }|${page}|${browseSort.value}`

const applyBrowseCache = (entry: BrowseCacheEntry, append: boolean, page: number) => {
  const items = append ? [...browseVideos.value, ...entry.items] : entry.items
  browseVideos.value = Array.from(new Map(items.map(item => [item._uid, item])).values())
  browsePage.value = page
  browsePageCount.value = entry.items.length ? entry.pageCount : page
  browseTotal.value = entry.total
  browseCategories.value = entry.categories
  if (browseSourceApi.value)
    browseCategoryCache.value[browseSourceApi.value] = entry.categories
}

/** 读取插件源的分类配置（CatSpider 的 tabs）。 */
const loadPluginTabs = async (siteName: string): Promise<BrowseCategory[]> => {
  try {
    const r = await getConfig(siteName)
    if (!r.success || !r.data) return []
    const config = r.data.config || r.data.data?.config || r.data
    const tabList = Array.isArray(config?.tabs) ? config.tabs : []
    return tabList.map((tab: any, index: number) => ({
      id: index,
      name: tab.name || `分类${index + 1}`,
      ext: tab.ext || {},
    }))
  } catch {
    return []
  }
}

/** 切换到插件源时，先取回它的分类再加载内容。 */
const setupPluginBrowse = async () => {
  const entry = currentEntry.value
  browseAbort?.abort()
  browseVideos.value = []
  browsePage.value = 1
  browsePageCount.value = 0
  browseTotal.value = 0
  browseError.value = ''
  browseMoreError.value = ''
  browseCategories.value = []
  if (!entry) return
  browseLoading.value = true
  const tabs = await loadPluginTabs(entry.name)
  browseLoading.value = false
  if (!tabs.length) {
    browseError.value = `${entry.name} 暂不支持分类浏览`
    return
  }
  browseCategories.value = tabs
  browseCategoryCache.value[entry.api] = tabs
  browseCategoryId.value = tabs[0].id
  browseCategoryName.value = tabs[0].name
  browseSort.value = 'latest'
  await loadBrowse()
}

/** 插件源分类内容：走 CatSpider 的 getCards。 */
const loadPluginBrowse = async (page: number, append: boolean) => {
  const entry = currentEntry.value
  if (!entry) return
  const tab = browseCategories.value.find(
    category => category.name === browseCategoryName.value
  )
  const ext = tab?.ext
  if (!ext) {
    browseVideos.value = []
    browseError.value = `${entry.name} 暂不支持分类浏览`
    browseLoading.value = false
    browseLoadingMore.value = false
    return
  }
  const controller = new AbortController()
  browseAbort = controller
  activeBrowseKey = browseCacheKey(page)
  browseLoading.value = !append
  browseLoadingMore.value = append
  browseError.value = ''
  try {
    const r = await getCards({
      siteName: entry.name,
      url: ext.url,
      ext: JSON.stringify(ext),
      page,
    })
    if (controller.signal.aborted || browseAbort !== controller) return
    if (!r.success || !r.data)
      throw new Error(r.error || `${entry.name} 没有返回可用内容`)
    const list = r.data.list || r.data.data?.list || []
    const items = (list as any[]).map(item => ({
      ...item,
      vod_id: item.vod_id || item.ext?.url || '',
      _source: entry.name,
      _uid: `${entry.name}-${item.vod_id || item.ext?.url || ''}`,
      _isPlugin: true,
      _siteName: entry.name,
      _ext: item.ext || {},
    }))
    const entryCache: BrowseCacheEntry = {
      items,
      pageCount: items.length ? page + 1 : page,
      total: 0,
      categories: browseCategories.value,
    }
    browseCache.set(browseCacheKey(page), entryCache)
    if (browseCache.size > 60)
      browseCache.delete(browseCache.keys().next().value as string)
    applyBrowseCache(entryCache, append, page)
    saveBrowseVisit()
  } catch (error) {
    if (!controller.signal.aborted && browseAbort === controller) {
      const text = error instanceof Error ? error.message : '加载分类内容失败'
      if (append) browseMoreError.value = text
      else {
        browseError.value = text
        browseVideos.value = []
      }
    }
  } finally {
    if (browseAbort === controller && !controller.signal.aborted) {
      browseLoading.value = false
      browseLoadingMore.value = false
      await nextTick()
      if (!browseError.value && !browseMoreError.value) onBrowseScroll()
    }
  }
}

const loadBrowse = async (force = false, append = false) => {
  if (append && (browseLoading.value || browseLoadingMore.value || !browseHasMore.value)) return
  const requestedPage = append ? browsePage.value + 1 : 1
  const selectedSource = currentBrowseSource.value
  if (!selectedSource) {
    browseAbort?.abort()
    browseLoading.value = false
    browseLoadingMore.value = false
    browseMoreError.value = ''
    browseVideos.value = []
    browsePageCount.value = 0
    browseTotal.value = 0
    browseError.value = '没有启用的数据源，请先在数据源管理中启用一个来源'
    return
  }
  const cacheKey = browseCacheKey(requestedPage)
  if (!force && browseLoading.value && activeBrowseKey === cacheKey) return
  const sources = [selectedSource]
  browseAbort?.abort()
  browseLoadingMore.value = false
  browseMoreError.value = ''
  if (!append) {
    browseVideos.value = []
    browsePage.value = 1
    browsePageCount.value = 0
    if (browseScroll.value) browseScroll.value.scrollTop = 0
  }
  const cached = browseCache.get(cacheKey)
  if (!force && cached) {
    browseError.value = ''
    applyBrowseCache(cached, append, requestedPage)
    browseLoading.value = false
    saveBrowseVisit()
    await nextTick()
    onBrowseScroll()
    return
  }
  if (isPluginSource.value) {
    await loadPluginBrowse(requestedPage, append)
    return
  }
  const controller = new AbortController()
  browseAbort = controller
  activeBrowseKey = cacheKey
  browseLoading.value = !append
  browseLoadingMore.value = append
  browseError.value = ''
  try {
    const settled = await Promise.allSettled(
      sources.map(async source => {
        const response = await fetch(
          createBrowseUrl(source, requestedPage),
          { signal: controller.signal }
        )
        if (!response.ok)
          throw new Error(`${source.name} 请求失败（HTTP ${response.status}）`)
        const data = await response.json()
        if (data.code !== 1 || !Array.isArray(data.list))
          throw new Error(data.msg || `${source.name} 没有返回可用内容`)
        return { source, data }
      })
    )
    if (controller.signal.aborted || browseAbort !== controller) return
    const results = settled.flatMap(result =>
      result.status === 'fulfilled' ? [result.value] : []
    )
    if (!results.length) throw new Error('所有启用数据源均未返回可用内容')
    const items = results.flatMap(({ source, data }) =>
      data.list.map((item: any) => ({
        ...item,
        _source: source.name,
        _uid: `${source.name}-${item.vod_id}`,
      }))
    )
    mergeBrowseCategories(items)
    const entry: BrowseCacheEntry = {
      items,
      pageCount: Number(results[0]?.data.pagecount || 0),
      total: results.reduce(
        (sum, result) => sum + Number(result.data.total || 0),
        0
      ),
      categories: browseCategories.value,
    }
    browseCache.set(cacheKey, entry)
    if (browseCache.size > 60)
      browseCache.delete(browseCache.keys().next().value as string)
    applyBrowseCache(entry, append, requestedPage)
    saveBrowseVisit()
  } catch (error) {
    if (!controller.signal.aborted && browseAbort === controller) {
      const text = error instanceof Error ? error.message : '加载分类内容失败'
      if (append) browseMoreError.value = text
      else browseError.value = text
    }
  } finally {
    if (browseAbort === controller && !controller.signal.aborted) {
      browseLoading.value = false
      browseLoadingMore.value = false
      await nextTick()
      if (!browseError.value && !browseMoreError.value) onBrowseScroll()
    }
  }
}

const selectBrowseCategory = (category: BrowseCategory) => {
  if (browseCategoryName.value === category.name) return
  browseCategoryId.value = category.id
  browseCategoryName.value = category.name
  browsePage.value = 1
  saveBrowseVisit()
  loadBrowse()
}

const catSpiderReady = ref(false)
const reconcileBrowseSource = () => {
  if (avEntries.value.some(entry => entry.api === browseSourceApi.value)) return
  browseSourceApi.value = avEntries.value[0]?.api ?? ''
}
watch(
  avEntries,
  () => {
    // 插件清单未就绪时不重置，否则会把已选插件源误判为失效。
    if (!catSpiderReady.value) return
    reconcileBrowseSource()
  },
  { immediate: true }
)
watch(browseSourceApi, () => {
  if (isPluginSource.value) {
    void setupPluginBrowse()
    return
  }
  restoreBrowseVisit()
  void loadBrowse()
})
watch(browseSort, () => { saveBrowseVisit(); void loadBrowse() })

// ─── 状态 ────────────────────────────────────────────────────
const searchKeyword = ref('')
const videos = shallowRef<any[]>([])
const loading = ref(false)
const hasSearched = ref(false)
const doneCount = ref(0)
const failedSourceCount = ref(0)
const searchError = ref('')
// 聚合搜索覆盖的站点：AV CMS 源 + 启用的成人插件源
const searchSourceCount = computed(
  () => activeSources.value.length + pluginAvSources.value.length
)
const runQuerySearch = () => {
  const query = String(route.query.q || '').trim()
  if (!query) {
    searchKeyword.value = ''
    videos.value = []
    hasSearched.value = false
    searchError.value = ''
    return
  }
  searchKeyword.value = query
  activeTab.value = 'search'
  handleSearch()
}
watch(
  () => route.query.q,
  () => runQuerySearch(),
  { immediate: true }
)

// ─── 播放历史 ─────────────────────────────────────────────────
interface AvPlayRecord {
  vod_name: string
  vod_pic: string
  _source: string
  epName: string
  url: string
  timestamp: number
  progress: number
  duration: number
  video: any
}
const playHistory = useStorage<AvPlayRecord[]>('av_play_history', [])

const savePlayHistory = (video: any, epName: string, url: string) => {
  const previous = playHistory.value.find(record => record.url === url)
  const record: AvPlayRecord = {
    vod_name: video.vod_name,
    vod_pic: video.vod_pic,
    _source: video._source,
    epName,
    url,
    timestamp: Date.now(),
    progress: previous?.progress ?? 0,
    duration: previous?.duration ?? 0,
    video,
  }
  playHistory.value = [
    record,
    ...playHistory.value.filter(item => item.url !== url),
  ].slice(0, 30)
}

// ─── 收藏 ─────────────────────────────────────────────────────
const favorites = useStorage<any[]>('av_favorites', [])
const toggleFav = (video: any) => {
  const exists = favorites.value.find((f: any) => f._uid === video._uid)
  if (exists)
    favorites.value = favorites.value.filter((f: any) => f._uid !== video._uid)
  else favorites.value = [...favorites.value, video]
}
const isFav = (video: any) =>
  favorites.value.some((f: any) => f._uid === video._uid)

// 播放器
const showPlayer = ref(false)
const playingVideo = ref<any>(null)
const playingUrl = ref('')
const videoEl = ref<HTMLVideoElement | null>(null)
const playingGroup = ref<{
  vod_name: string
  vod_pic: string
  items: any[]
} | null>(null)
const playerMessage = ref('')
const volume = useStorage<number>('av_volume', 1)
const attemptedSourceIds = new Set<string>()
let switchingSource = false
let resumeTime = 0
let lastProgressSave = 0

// 增量去重合并 — 避免每次 videos 变化都重建整个 Map
const mergedMap = new Map<
  string,
  { key: string; vod_name: string; vod_pic: string; items: any[] }
>()
const mergedVideos = shallowRef<
  { key: string; vod_name: string; vod_pic: string; items: any[] }[]
>([])

function rebuildMerged() {
  mergedMap.clear()
  for (const v of videos.value) {
    const key = v.vod_name.trim().toLowerCase()
    const existing = mergedMap.get(key)
    if (existing) {
      existing.items.push(v)
    } else {
      mergedMap.set(key, {
        key,
        vod_name: v.vod_name,
        vod_pic: v.vod_pic,
        items: [v],
      })
    }
  }
  mergedVideos.value = Array.from(mergedMap.values())
}

// 在 playVideo 中直接用 Map 查找，避免遍历数组
function findGroup(name: string) {
  const key = name.trim().toLowerCase()
  return mergedMap.get(key) || null
}

const formatTime = (ts: number) => {
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

let currentAbort: AbortController | null = null

// ─── 单站请求（带超时） ──────────────────────────────────────
const fetchFromSource = async (
  source: AvSite,
  keyword: string,
  signal: AbortSignal
): Promise<any[]> => {
  try {
    const url = keyword
      ? `${source.api}?ac=detail&wd=${encodeURIComponent(keyword)}`
      : `${source.api}?ac=detail`
    const timeout = AbortSignal.timeout(8000)
    const merged = AbortSignal.any([signal, timeout])
    const res = await fetch(url, { signal: merged })
    const data = await res.json()
    if (data.code === 1 && Array.isArray(data.list)) {
      return data.list.map((v: any) => ({
        ...v,
        _source: source.name,
        _uid: `${source.name}-${v.vod_id}`,
      }))
    }
  } catch {
    if (!signal.aborted) failedSourceCount.value++
  }
  return []
}

/** 插件源搜索：走 CatSpider 的 search 动作，返回条目仍需 fetchDetail 才能拿到线路。 */
const fetchFromPluginSource = async (
  site: CatSpiderSite,
  keyword: string,
  signal: AbortSignal
): Promise<any[]> => {
  try {
    const r = await vodSearch({ siteName: site.name, keyword }, signal)
    if (!r.success || !r.data) {
      if (!signal.aborted) failedSourceCount.value++
      return []
    }
    let payload: any = r.data
    for (let i = 0; i < 2 && typeof payload === 'string'; i++) {
      try {
        payload = JSON.parse(payload)
      } catch {
        return []
      }
    }
    const nested = payload?.data
    const list = Array.isArray(payload?.list)
      ? payload.list
      : Array.isArray(nested?.list)
        ? nested.list
        : []
    return (list as any[]).map(item => ({
      ...item,
      vod_id: item.vod_id || item.ext?.url || '',
      _source: site.name,
      _uid: `${site.name}-${item.vod_id || item.ext?.url || ''}`,
      _isPlugin: true,
      _siteName: site.name,
      _ext: item.ext || {},
    }))
  } catch {
    if (!signal.aborted) failedSourceCount.value++
    return []
  }
}

const searchCache = new Map<string, { expiresAt: number; items: any[] }>()
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
) => {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run)
  )
  return results
}

const handleSearch = async () => {
  const keyword = searchKeyword.value.trim()
  if (!keyword) {
    hasSearched.value = true
    searchError.value = '请输入番号或关键词'
    return
  }
  if (currentAbort) currentAbort.abort()
  currentAbort = new AbortController()
  const signal = currentAbort.signal

  loading.value = true
  hasSearched.value = true
  doneCount.value = 0
  failedSourceCount.value = 0
  searchError.value = ''
  videos.value = []
  rebuildMerged()

  const cmsSources = getActiveSources()
  const pluginSources = pluginAvSources.value
  const totalQuery = cmsSources.length + pluginSources.length
  const cacheKey = `${keyword}|${[
    ...cmsSources.map(source => source.api),
    ...pluginSources.map(site => site.api),
  ]
    .sort()
    .join(',')}`
  const cached = searchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    videos.value = cached.items
    doneCount.value = totalQuery
    rebuildMerged()
    loading.value = false
    return
  }

  // 限制并发请求；每个站点返回后立即合并结果，不等待全部站点完成。
  const [cmsResults, pluginResults] = await Promise.all([
    mapWithConcurrency(cmsSources, 4, async source => {
      const items = await fetchFromSource(source, keyword, signal)
      if (!signal.aborted) {
        doneCount.value++
        if (items.length) {
          videos.value = [...videos.value, ...items]
          rebuildMerged()
        }
      }
      return items
    }),
    mapWithConcurrency(pluginSources, 3, async site => {
      const items = await fetchFromPluginSource(site, keyword, signal)
      if (!signal.aborted) {
        doneCount.value++
        if (items.length) {
          videos.value = [...videos.value, ...items]
          rebuildMerged()
        }
      }
      return items
    }),
  ])
  if (signal.aborted) return
  const allItems = [...cmsResults.flat(), ...pluginResults.flat()]
  searchCache.set(cacheKey, {
    expiresAt: Date.now() + 5 * 60 * 1000,
    items: allItems,
  })
  if (searchCache.size > 30)
    searchCache.delete(searchCache.keys().next().value as string)
  // 增量结果已经渲染；这里仅用于缓存，避免最后一次重复重建。

  if (!signal.aborted) {
    loading.value = false
    if (allItems.length === 0 && failedSourceCount.value > 0)
      searchError.value = '已启用的数据源暂时均不可用'
  }
}

// ─── 播放 ─────────────────────────────────────────────────────
const parseCmsEpisodes = (video: any) =>
  String(video?.vod_play_url || '')
    .split('#')
    .filter(Boolean)
    .map((ep: string) => {
      const parts = ep.split('$')
      return { name: parts[0], url: parts[parts.length - 1] }
    })

/** 插件源：先用 getTracks 取回线路，再由 startPlay 解析成可播放地址。 */
const playPluginVideo = async (video: any) => {
  playerMessage.value = ''
  let groups: any[] = []
  try {
    groups = await fetchDetail({
      vod_id: video.vod_id,
      vod_name: video.vod_name || '',
      type_name: video.type_name || '',
      vod_year: video.vod_year || '',
      vod_remarks: video.vod_remarks || '',
      vod_pic: video.vod_pic || '',
      _source: 'catspider',
      _siteName: video._siteName,
      _ext: video._ext,
    })
  } catch {
    groups = []
  }
  const episodes = (groups || [])
    .flatMap(group => group.episodes || [])
    .filter(episode => episode?.url)
  if (!episodes.length) {
    playerMessage.value = '没有可用的播放线路'
    message.error('没有可用的播放线路')
    return
  }
  playingVideo.value = { ...video, episodes }
  playingGroup.value = findGroup(video.vod_name) || {
    vod_name: video.vod_name,
    vod_pic: video.vod_pic,
    items: [video],
  }
  resumeTime = 0
  await startPlay(
    episodes[0].url,
    episodes[0].name,
    episodes[0].ext,
    video._siteName
  )
}

const playVideo = async (video: any) => {
  if (video._isPlugin) {
    attemptedSourceIds.clear()
    attemptedSourceIds.add(video._uid)
    resumeTime = 0
    await playPluginVideo(video)
    return
  }
  if (!video.vod_play_url) return

  const episodes = parseCmsEpisodes(video)
  if (episodes.length === 0) return

  playingVideo.value = { ...video, episodes }
  // O(1) 查找合并组
  const found = findGroup(video.vod_name)
  playingGroup.value = found || {
    vod_name: video.vod_name,
    vod_pic: video.vod_pic,
    items: [video],
  }
  attemptedSourceIds.clear()
  attemptedSourceIds.add(video._uid)
  resumeTime = 0
  playerMessage.value = ''
  await startPlay(episodes[0].url, episodes[0].name)
}

const switchSource = async (video: any, automatic = false) => {
  if (video._isPlugin) {
    playerMessage.value = automatic
      ? `当前线路不可用，已切换到 ${video._source}`
      : ''
    attemptedSourceIds.add(video._uid)
    resumeTime = 0
    await playPluginVideo(video)
    return
  }
  if (!video.vod_play_url) return
  const episodes = parseCmsEpisodes(video)
  if (episodes.length === 0) return
  playingVideo.value = { ...video, episodes }
  attemptedSourceIds.add(video._uid)
  resumeTime = 0
  playerMessage.value = automatic
    ? `当前线路不可用，已切换到 ${video._source}`
    : ''
  await startPlay(episodes[0].url, episodes[0].name)
}

const tryNextSource = async () => {
  if (switchingSource) return
  const next = playingGroup.value?.items.find(
    item => !attemptedSourceIds.has(item._uid)
  )
  if (!next) {
    playerMessage.value = '当前内容的可用线路均播放失败'
    return
  }
  switchingSource = true
  try {
    await switchSource(next, true)
  } finally {
    switchingSource = false
  }
}

const PLAYABLE_URL_RE = /^https?:\/\/\S+\.(?:m3u8|mp4|flv)(?:[?#]|$)/i

const startPlay = async (
  url: string,
  epName = '',
  ext?: Record<string, any>,
  siteName?: string,
  resumeAt?: number
) => {
  let playUrl = url
  // 插件线路需要经插件解析成真实地址；已是直链则跳过。
  if (siteName && url && !PLAYABLE_URL_RE.test(url)) {
    const resolved = await resolvePlayUrl(siteName, { ...(ext || {}), url })
    if (resolved) playUrl = resolved
  }
  playingUrl.value = playUrl
  if (playingVideo.value) savePlayHistory(playingVideo.value, epName, playUrl)
  const title =
    [playingVideo.value?.vod_name, epName].filter(Boolean).join(' · ') ||
    '正在播放'
  // Electron：强制独立播放窗；页内层仅作非 Electron 兜底
  if (canOpenElectronPlayer()) {
    const poster = playingVideo.value?.vod_pic || undefined
    const startAt = resumeAt ?? getMediaProgress(playUrl)
    const ok = await openMediaPlayer({ url: playUrl, title, poster, startAt })
    showPlayer.value = false
    videoEl.value = null
    if (!ok) {
      message.error('无法打开独立播放窗口，请完全重启应用后再试')
    }
    return
  }
  showPlayer.value = true
}

const playMissavStream = async (stream: MissavStream, startAt = 0) => {
  const video = {
    vod_id: stream.input,
    vod_name: stream.title,
    vod_pic: '',
    _source: 'MissAV',
    _uid: `missav-${stream.input}`,
    _missavInput: stream.input,
    episodes: [{ name: '在线播放', url: stream.url }],
  }
  playingVideo.value = video
  playingGroup.value = { vod_name: video.vod_name, vod_pic: '', items: [video] }
  attemptedSourceIds.clear()
  attemptedSourceIds.add(video._uid)
  switchingSource = false
  playerMessage.value = ''
  resumeTime = startAt
  await startPlay(stream.url, '在线播放', undefined, undefined, startAt)
}

const applyPlaybackSettings = () => {
  const el = videoEl.value
  if (!el) return
  el.volume = Math.min(1, Math.max(0, Number(volume.value) || 0))
}

const onPlayerReady = (video: HTMLVideoElement) => {
  videoEl.value = video
  applyPlaybackSettings()
}

const resumeHistory = async (record: AvPlayRecord) => {
  const video = record.video
  if (video._missavInput) {
    try {
      await playMissavStream(
        await resolveMissav(video._missavInput),
        record.progress
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'MissAV 重新解析失败')
    }
    return
  }
  const episodes = video.episodes?.length
    ? video.episodes
    : parseCmsEpisodes(video)
  playingVideo.value = { ...video, episodes }
  playingGroup.value = findGroup(video.vod_name) || {
    vod_name: video.vod_name,
    vod_pic: video.vod_pic,
    items: [video],
  }
  attemptedSourceIds.clear()
  switchingSource = false
  attemptedSourceIds.add(video._uid)
  resumeTime = record.progress
  playerMessage.value = record.progress > 5 ? '继续上次播放' : ''
  // Electron 独立窗口无法回写进度；仅 overlay 模式支持 resumeTime
  await startPlay(record.url, record.epName)
}

const handleLoadedMetadata = () => {
  const el = videoEl.value
  if (!el) return
  applyPlaybackSettings()
  if (resumeTime > 5 && resumeTime < el.duration - 10)
    el.currentTime = resumeTime
  resumeTime = 0
}

const handleTimeUpdate = () => {
  const el = videoEl.value
  if (
    !el ||
    !playingVideo.value ||
    !playingUrl.value ||
    Date.now() - lastProgressSave < 1000
  )
    return
  lastProgressSave = Date.now()
  const record = playHistory.value.find(item => item.url === playingUrl.value)
  if (!record) return
  record.progress = el.currentTime
  record.duration = Number.isFinite(el.duration) ? el.duration : 0
  record.timestamp = Date.now()
}

const handleVideoError = () => {
  tryNextSource()
}

const handleVideoEnded = async () => {
  const episodes = playingVideo.value?.episodes ?? []
  const currentIndex = episodes.findIndex(
    (episode: any) => episode.url === playingUrl.value
  )
  const next = currentIndex >= 0 ? episodes[currentIndex + 1] : null
  if (next) {
    playerMessage.value = `即将播放：${next.name}`
    await startPlay(
      next.url,
      next.name,
      (next as any).ext,
      playingVideo.value?._siteName
    )
  } else {
    const groups =
      activeTab.value === 'search'
        ? mergedVideos.value
        : activeTab.value === 'browse'
          ? sortedBrowseVideos.value.map(video => ({ items: [video] }))
          : []
    const currentKey = playingVideo.value?.vod_name?.trim().toLowerCase()
    const currentIndex = groups.findIndex(
      group => group.items[0]?.vod_name?.trim().toLowerCase() === currentKey
    )
    const nextVideo =
      currentIndex >= 0 ? groups[currentIndex + 1]?.items[0] : null
    if (nextVideo) {
      playerMessage.value = `即将播放：${nextVideo.vod_name}`
      await playVideo(nextVideo)
    } else {
      playerMessage.value = '已播放完当前内容'
    }
  }
}

const handlePlayerKeydown = (event: KeyboardEvent) => {
  const el = videoEl.value
  if (!el) return
  if (event.key === ' ') {
    event.preventDefault()
    if (el.paused) el.play().catch(() => {})
    else el.pause()
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    el.currentTime = Math.max(
      0,
      el.currentTime + (event.key === 'ArrowLeft' ? -10 : 10)
    )
  } else if (event.key.toLowerCase() === 'm') {
    el.muted = !el.muted
  }
}

const handleVolumeChange = () => {
  const el = videoEl.value
  if (el && !el.muted) volume.value = el.volume
}

const closePlayer = () => {
  showPlayer.value = false
  playingVideo.value = null
  playingUrl.value = ''
  playerMessage.value = ''
  resumeTime = 0
  if (videoEl.value) videoEl.value.src = ''
  void window.api?.player?.close?.()
}

const handleNavigateBack = (event: Event) => {
  if (!showPlayer.value && !playingUrl.value) return
  closePlayer()
  event.preventDefault()
}

// 图片加载失败
const handleImageError = (e: Event) => {
  const target = e.target as HTMLImageElement
  target.style.display = 'none'
}

onBeforeUnmount(() => {
  browseAbort?.abort()
  currentAbort?.abort()
})
onMounted(async () => {
  window.addEventListener('app:navigate-back', handleNavigateBack)
  // 插件源清单来自后端，先加载完再决定当前数据源，避免误判为失效源。
  await loadCatSpiderSites()
  catSpiderReady.value = true
  const before = browseSourceApi.value
  reconcileBrowseSource()
  if (browseSourceApi.value !== before) {
    // 数据源已切换，交给 browseSourceApi 的 watcher 加载。
  } else if (isPluginSource.value) {
    await setupPluginBrowse()
  } else {
    restoreBrowseVisit()
    await loadBrowse()
  }
  if (route.query.tab === 'search') runQuerySearch()
})
onBeforeUnmount(() =>
  window.removeEventListener('app:navigate-back', handleNavigateBack)
)
</script>

<style scoped>
.av-page {
  min-height: 100%;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 自定义滚动条 */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}
.av-page {
  color: var(--text-primary);
}
.av-tab {
  color: var(--text-secondary);
  background: transparent;

  border-radius: 7px;

  min-height: 36px;
}
.av-tab:hover {
  color: var(--text-primary);
}
.av-tab.is-active {
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);

  background: var(--selection-bg);
  box-shadow: none;
}
.av-card {
  border: 0;
  background: transparent;

  border-color: var(--border-subtle);

  border-radius: 6px;
}
.av-card:hover {
  border-color: var(--border-default);
  background: var(--bg-fill-tertiary);
}
.av-card-title {
  color: var(--text-primary);
}
.av-skel {
  background: var(--bg-fill-secondary);
}
.av-skel-line {
  background: var(--bg-fill-secondary);
}
.av-ghost-btn {
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  background: transparent;
  border-radius: 7px;
  min-height: var(--control-height);
  padding: 0 18px;
  transition: var(--transition-fast);
  cursor: pointer;
}
.av-ghost-btn:hover {
  background: var(--bg-glass-hover);
  color: var(--text-primary);
}
.av-empty-border {
  border-color: var(--border-default);
}
.av-progress {
  background: var(--accent);
}
</style>
