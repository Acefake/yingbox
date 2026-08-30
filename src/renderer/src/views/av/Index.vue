<template>
  <div class="av-page h-full overflow-hidden text-white flex flex-col">
    <!-- Tab 导航 + 搜索栏 -->
    <div class="flex-shrink-0 bg-transparent">
      <!-- Tab 行 -->
      <div class="flex items-center gap-6 px-4 pt-3 pb-0">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="h-12 px-0 rounded-lg text-[15px] transition-colors"
          :class="activeTab === tab.id
            ? 'text-blue-500 font-semibold'
            : 'bg-transparent text-white/60 hover:text-white'"
          @click="activeTab = tab.id"
        >{{ tab.label }}</button>
      </div>
      <!-- 浏览工具栏 -->
      <div v-if="activeTab === 'browse'" class="px-4 py-3">
        <MediaFilterBar :rows="avFilterRows" :model-value="avFilterModel" @update:model-value="onFilterChange" />
      </div>
    </div>

    <!-- 分类浏览内容 -->
    <div v-if="activeTab === 'browse'" class="primary-scroll flex-1 overflow-y-auto p-6">
      <div v-if="browseLoading" class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        <div v-for="i in 12" :key="i" class="animate-pulse overflow-hidden rounded-xl border border-white/5 bg-white/5"><div class="aspect-video bg-white/10" /><div class="space-y-2 p-3"><div class="h-3 w-4/5 rounded bg-white/10" /><div class="h-3 w-2/5 rounded bg-white/10" /></div></div>
      </div>
      <div v-else-if="browseError" class="flex min-h-60 flex-col items-center justify-center gap-3 text-center"><p class="text-sm text-red-300">{{ browseError }}</p><button class="h-10 rounded-lg bg-white/10 px-4 text-sm hover:bg-white/15" @click="loadBrowse()">重新加载</button></div>
      <template v-else>
        <div class="mb-4 flex items-center justify-between"><div><h2 class="text-base font-semibold">{{ currentBrowseCategoryName }}</h2><p class="mt-1 text-xs text-white/40">{{ currentBrowseSource?.name || '未选择数据源' }} · 第 {{ browsePage }} / {{ browsePageCount || 1 }} 页<span v-if="browseTotal"> · 共 {{ browseTotal.toLocaleString() }} 条</span></p></div><button class="h-9 rounded-lg border border-white/10 px-3 text-xs text-white/70 hover:bg-white/10" @click="loadBrowse(true)">刷新</button></div>
        <div v-if="sortedBrowseVideos.length" class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          <div v-for="video in sortedBrowseVideos" :key="`${video._source}-${video.vod_id}`" class="group cursor-pointer overflow-hidden rounded-xl border border-white/5 bg-white/[0.035] transition-all hover:-translate-y-0.5 hover:border-blue-400/30 hover:bg-white/[0.07]" @click="playVideo(video)">
            <div class="relative aspect-video overflow-hidden bg-black"><img :src="video.vod_pic" :alt="video.vod_name" class="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]" loading="lazy" decoding="async" @error="handleImageError" /><span v-if="video.vod_remarks" class="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px]">{{ video.vod_remarks }}</span><button class="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-lg" :class="isFav(video) ? 'text-yellow-400' : 'text-white/70 hover:text-yellow-300'" @click.stop="toggleFav(video)">{{ isFav(video) ? '♥' : '♡' }}</button></div>
            <div class="p-3"><h3 class="line-clamp-2 min-h-10 text-sm font-medium leading-5 text-white">{{ video.vod_name }}</h3><p class="mt-2 truncate text-xs text-white/45">{{ video.type_name || '未分类' }} · {{ video.vod_duration || '时长未知' }}</p></div>
          </div>
        </div>
        <div v-else class="flex min-h-60 items-center justify-center text-sm text-white/40">这个分类暂时没有内容</div>
        <div v-if="browsePageCount > 1" class="mt-8 flex items-center justify-center gap-3"><button class="h-10 rounded-lg border border-white/10 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40 hover:bg-white/10" :disabled="browsePage <= 1" @click="changeBrowsePage(-1)">上一页</button><span class="text-sm text-white/50">{{ browsePage }} / {{ browsePageCount }}</span><button class="h-10 rounded-lg border border-white/10 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40 hover:bg-white/10" :disabled="browsePage >= browsePageCount" @click="changeBrowsePage(1)">下一页</button></div>
      </template>
    </div>

    <!-- 聚合搜索内容 -->
    <div v-if="activeTab === 'search'" class="primary-scroll flex-1 overflow-y-auto p-6">
      <!-- 加载进度 -->
      <div v-if="loading" class="flex flex-col items-center justify-center py-8 gap-3">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <p class="text-sm text-gray-400">正在聚合 {{ activeSources.length }} 个站点... ({{ doneCount }}/{{ activeSources.length }})</p>
        <div class="w-64 bg-white/10 rounded-full h-1.5">
          <div class="bg-blue-500 h-1.5 rounded-full transition-all" :style="{ width: `${doneCount / activeSources.length * 100}%` }"></div>
        </div>
      </div>
      <div v-if="loading && mergedVideos.length === 0" class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        <div v-for="i in 12" :key="i" class="animate-pulse overflow-hidden rounded-xl border border-white/5 bg-white/5"><div class="aspect-video bg-white/10" /><div class="space-y-2 p-3"><div class="h-3 w-4/5 rounded bg-white/10" /><div class="h-3 w-2/5 rounded bg-white/10" /></div></div>
      </div>
      <div v-if="searchError" class="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
        <p class="text-sm text-red-300">{{ searchError }}</p>
        <button v-if="searchKeyword.trim()" class="h-10 rounded-lg bg-white/10 px-4 text-sm hover:bg-white/15" @click="handleSearch">重试搜索</button>
      </div>
      <!-- 合并结果网格 -->
      <div v-if="mergedVideos.length > 0" class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" :class="{ 'mt-4': loading }">
        <div
          v-for="group in mergedVideos"
          :key="group.key"
          class="group cursor-pointer overflow-hidden rounded-xl border border-white/5 bg-white/[0.035] transition-all hover:-translate-y-0.5 hover:border-blue-400/30 hover:bg-white/[0.07]"
          @click="playVideo(group.items[0])"
        >
          <div class="relative overflow-hidden bg-gray-800" style="aspect-ratio:16/9">
            <img :src="group.vod_pic" :alt="group.vod_name" class="w-full h-full object-contain bg-black" loading="lazy" decoding="async" @error="handleImageError" />
            <div class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
              <div class="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <svg class="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 5.84a.75.75 0 011.06.02l3.858 4.5a.75.75 0 010 .98l-3.858 4.5A.75.75 0 016 14.5V5.75a.75.75 0 01.3-.91z"/>
                </svg>
              </div>
            </div>
            <div v-if="group.items[0].vod_remarks" class="absolute bottom-1 right-1 bg-black/60 px-1.5 py-0.5 rounded text-[10px] text-white">{{ group.items[0].vod_remarks }}</div>
            <button class="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-lg transition-colors" :class="isFav(group.items[0]) ? 'text-yellow-400' : 'text-white/70 hover:text-yellow-300'" @click.stop="toggleFav(group.items[0])">{{ isFav(group.items[0]) ? '♥' : '♡' }}</button>
          </div>
          <div class="p-3">
            <h3 class="line-clamp-2 min-h-10 text-sm font-medium leading-5 text-white">{{ group.vod_name }}</h3>
            <p class="mt-2 truncate text-xs text-white/45">{{ group.items.length }} 个可用来源</p>
          </div>
        </div>
      </div>
      <!-- 无结果提示 -->
      <div v-if="!loading && !searchError && mergedVideos.length === 0 && hasSearched" class="flex min-h-52 flex-col items-center justify-center text-gray-400">
        <p class="text-sm">未找到相关结果</p>
      </div>
      <div v-if="!loading && !hasSearched" class="flex min-h-64 flex-col items-center justify-center text-center">
        <p class="text-sm text-white/60">搜索全部启用数据源</p>
        <p class="mt-2 text-xs text-white/30">输入番号或关键词后按回车</p>
      </div>
    </div>

    <!-- 收藏 -->
    <div v-if="activeTab === 'favorites'" class="primary-scroll flex-1 overflow-y-auto p-6">
      <div class="mb-5 flex items-center justify-between gap-3"><div><h2 class="text-base font-semibold">收藏</h2><p class="mt-1 text-xs text-white/40">AV 资源收藏</p></div><button v-if="favorites.length" class="h-9 rounded-lg px-3 text-xs text-white/40 hover:bg-white/10 hover:text-white/70" @click="favorites = []">清空</button></div>
      <div v-if="favorites.length">
        <div class="flex items-center gap-2 mb-4">
          <span class="text-sm text-white/50">共 {{ favorites.length }} 个收藏</span>
          <button class="ml-auto h-9 rounded-lg px-3 text-xs text-white/40 hover:bg-white/10 hover:text-white/70" @click="favorites = []">清空全部</button>
        </div>
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          <div v-for="fav in favorites" :key="fav._uid" class="group cursor-pointer overflow-hidden rounded-xl border border-white/5 bg-white/[0.035] transition-all hover:-translate-y-0.5 hover:border-blue-400/30 hover:bg-white/[0.07]" @click="playVideo(fav)">
            <div class="relative aspect-video bg-black">
              <img :src="fav.vod_pic" loading="lazy" decoding="async" class="w-full h-full object-contain bg-black" @error="handleImageError" />
              <div class="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white/80">{{ fav._source }}</div>
              <button class="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-lg text-yellow-400" @click.stop="toggleFav(fav)">♥</button>
            </div>
            <p class="line-clamp-2 min-h-16 p-3 text-sm font-medium leading-5 text-white/90">{{ fav.vod_name }}</p>
          </div>
        </div>
      </div>
      <div v-else class="flex min-h-40 flex-col items-center justify-center text-gray-500 gap-2 rounded-xl border border-dashed border-white/10">
        <p class="text-4xl mb-2">♡</p>
        <p>还没有收藏</p>
        <p class="text-xs">在搜索结果中点击 ♡ 收藏</p>
      </div>
    </div>

    <!-- 播放历史 -->
    <div v-if="activeTab === 'history'" class="primary-scroll flex-1 overflow-y-auto p-6">
      <div class="mb-5 flex items-center justify-between gap-3"><div><h2 class="text-base font-semibold">播放历史</h2><p class="mt-1 text-xs text-white/40">AV 资源播放记录</p></div><button v-if="playHistory.length" class="h-9 rounded-lg px-3 text-xs text-white/40 hover:bg-white/10 hover:text-white/70" @click="playHistory = []">清空</button></div>
      <div v-if="playHistory.length" class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div v-for="rec in playHistory" :key="rec.url" class="flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border border-white/5 bg-white/[0.035] px-3 py-2 transition-colors hover:border-blue-400/30 hover:bg-white/[0.07]" @click="resumeHistory(rec)">
            <img :src="rec.vod_pic" loading="lazy" decoding="async" class="h-14 w-20 flex-shrink-0 rounded-lg bg-black object-contain" @error="handleImageError" />
            <div class="min-w-0 flex-1">
              <p class="text-sm text-white/80 truncate">{{ rec.vod_name }}</p>
              <p class="text-[11px] text-white/40">{{ rec.epName }} · {{ rec._source }}</p>
              <p class="text-[10px] text-white/25">{{ formatTime(rec.timestamp) }}</p>
              <div v-if="rec.duration > 0" class="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10"><div class="h-full rounded-full bg-blue-500" :style="{ width: `${Math.min(100, rec.progress / rec.duration * 100)}%` }" /></div>
            </div>
          </div>
        </div>
      <div v-else class="flex min-h-40 items-center justify-center text-sm text-gray-500">暂无播放记录</div>
      </div>

    <!-- 播放器：仅保留视频画面与原生控制条 -->
    <Transition name="sheet-fade">
      <div v-if="showPlayer" class="fixed inset-0 z-[1200] flex items-center justify-center bg-black/75" @click.self="closePlayer">
        <div class="av-player-page relative flex max-h-[92vh] w-[92vw] items-center justify-center overflow-hidden rounded-xl bg-black">
          <button class="absolute right-4 top-3 z-10 text-2xl leading-none text-white/60 hover:text-white" aria-label="关闭播放器" @click="closePlayer">×</button>
        <p v-if="playerMessage" class="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded bg-black/70 px-3 py-2 text-xs text-white/80">{{ playerMessage }}</p>
        <video
          ref="videoEl"
          class="h-full w-full object-contain"
          controls
          autoplay
          :poster="playingVideo?.vod_pic"
          tabindex="0"
          @loadedmetadata="handleLoadedMetadata"
          @timeupdate="handleTimeUpdate"
          @volumechange="handleVolumeChange"
          @error="handleVideoError"
          @ended="handleVideoEnded"
          @keydown="handlePlayerKeydown"
        />
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import Hls from 'hls.js'
import { useRoute } from 'vue-router'
import { backend } from '@/api/backend'
import { useAvSources, type AvSite } from './use-av-sources'
import MediaFilterBar, { type MediaFilterRow } from '@/components/MediaFilterBar.vue'

// ─── Tab ─────────────────────────────────────────────────────
const tabs = [
  { id: 'browse', label: '浏览' },
  { id: 'favorites', label: '收藏' },
  { id: 'history', label: '播放历史' },
] as const
type AvTab = 'browse' | 'search' | 'favorites' | 'history'
const activeTab = useStorage<AvTab>('av_active_tab', 'browse')
const route = useRoute()

// ─── 站点（使用启用列表） ─────────────────────────────────────
const { getActiveSources, activeSources } = useAvSources()

// ─── 单源分类浏览 ─────────────────────────────────────────────
type BrowseCategory = { id: number | null; name: string }
type BrowseVisit = { categoryId: number | null; categoryName: string; page: number; sort: 'latest' | 'hot' | 'rating' }
const browseSourceApi = useStorage('av_browse_source', '')
const browseCategoryId = ref<number | null>(null)
const browseCategoryName = ref('全部')
const browseCategories = ref<BrowseCategory[]>([{ id: null, name: '全部' }])
const avFilterRows = computed<MediaFilterRow[]>(() => [
  {
    key: 'source',
    label: '数据源',
    options: activeSources.value.map(source => ({ label: source.name, value: source.api })),
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
    options: browseCategories.value.map(category => ({ label: category.name, value: category.name })),
  },
])
const avFilterModel = computed(() => ({ source: browseSourceApi.value, sort: browseSort.value, category: browseCategoryName.value }))
const onFilterChange = (value: Record<string, string>) => {
  if (value.source && value.source !== browseSourceApi.value) browseSourceApi.value = value.source
  if (value.sort && value.sort !== browseSort.value) browseSort.value = value.sort as 'latest' | 'hot' | 'rating'
  if (value.category && value.category !== browseCategoryName.value) {
    const category = browseCategories.value.find(item => item.name === value.category)
    if (category) selectBrowseCategory(category)
  }
}
const browseVideos = shallowRef<any[]>([])
const browsePage = ref(1)
const browsePageCount = ref(0)
const browseTotal = ref(0)
const browseLoading = ref(false)
const browseError = ref('')
const browseSort = ref<'latest' | 'hot' | 'rating'>('latest')
const browseVisits = useStorage<Record<string, BrowseVisit>>('av_browse_visits', {})
const browseCategoryCache = useStorage<Record<string, BrowseCategory[]>>('av_browse_categories', {})
type BrowseCacheEntry = { items: any[]; pageCount: number; total: number; categories: BrowseCategory[] }
const browseCache = new Map<string, BrowseCacheEntry>()
let browseAbort: AbortController | null = null
let activeBrowseKey = ''

const currentBrowseSource = computed(() =>
  activeSources.value.find(source => source.api === browseSourceApi.value)
)
const currentBrowseCategoryName = computed(() =>
  browseCategoryName.value
)
const normalizeCategoryName = (name: unknown) => String(name ?? '').trim()
const sortedBrowseVideos = computed(() => [...browseVideos.value]
  .sort((a, b) => {
  if (browseSort.value === 'hot') return Number(b.vod_hits_week || 0) - Number(a.vod_hits_week || 0)
  if (browseSort.value === 'rating') return Number(b.vod_score || 0) - Number(a.vod_score || 0)
  return String(b.vod_time_add || b.vod_time || '').localeCompare(String(a.vod_time_add || a.vod_time || ''))
}))

const createBrowseUrl = (source: AvSite, page: number) => {
  const params = new URLSearchParams({ ac: 'detail', pg: String(page) })
  if (browseCategoryId.value !== null) params.set('t', String(browseCategoryId.value))
  return `${source.api}?${params}`
}

const mergeBrowseCategories = (items: any[]) => {
  const byId = new Map<number, BrowseCategory>(
    browseCategories.value
      .filter((category): category is BrowseCategory & { id: number } => category.id !== null)
      .map(category => [category.id, category])
  )
  for (const item of items) {
    const name = normalizeCategoryName(item.type_name)
    const id = Number(item.type_id)
    if (Number.isFinite(id) && name && !byId.has(id)) byId.set(id, { id, name })
  }
  browseCategories.value = [
    { id: null, name: '全部' },
    ...Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
  ]
  if (browseSourceApi.value) browseCategoryCache.value[browseSourceApi.value] = browseCategories.value
}

const saveBrowseVisit = () => {
  if (!browseSourceApi.value) return
  browseVisits.value[browseSourceApi.value] = {
    categoryId: browseCategoryId.value,
    categoryName: browseCategoryName.value,
    page: browsePage.value,
    sort: browseSort.value,
  }
}

const restoreBrowseVisit = () => {
  const saved = browseVisits.value[browseSourceApi.value]
  browseCategories.value = browseCategoryCache.value[browseSourceApi.value] ?? [{ id: null, name: '全部' }]
  browseCategoryId.value = saved?.categoryId ?? null
  browseCategoryName.value = saved?.categoryName ?? '全部'
  browsePage.value = saved?.page ?? 1
  browseSort.value = saved?.sort ?? 'latest'
}

const browseCacheKey = () => `${browseSourceApi.value}|${browseCategoryId.value ?? 'all'}|${browsePage.value}|${browseSort.value}`

const applyBrowseCache = (entry: BrowseCacheEntry) => {
  browseVideos.value = entry.items
  browsePageCount.value = entry.pageCount
  browseTotal.value = entry.total
  browseCategories.value = entry.categories
  if (browseSourceApi.value) browseCategoryCache.value[browseSourceApi.value] = entry.categories
}

const loadBrowse = async (force = false) => {
  const selectedSource = currentBrowseSource.value
  if (!selectedSource) {
    browseVideos.value = []
    browseError.value = '没有启用的数据源，请先在数据源管理中启用一个来源'
    return
  }
  const cacheKey = browseCacheKey()
  if (!force && browseLoading.value && activeBrowseKey === cacheKey) return
  const sources = [selectedSource]
  browseAbort?.abort()
  const cached = browseCache.get(cacheKey)
  if (!force && cached) {
    browseError.value = ''
    applyBrowseCache(cached)
    browseLoading.value = false
    saveBrowseVisit()
    return
  }
  const controller = new AbortController()
  browseAbort = controller
  activeBrowseKey = cacheKey
  browseLoading.value = true
  browseError.value = ''
  try {
    const settled = await Promise.allSettled(sources.map(async source => {
      const response = await fetch(createBrowseUrl(source, browsePage.value), { signal: controller.signal })
      if (!response.ok) throw new Error(`${source.name} 请求失败（HTTP ${response.status}）`)
      const data = await response.json()
      if (data.code !== 1 || !Array.isArray(data.list)) throw new Error(data.msg || `${source.name} 没有返回可用内容`)
      return { source, data }
    }))
    const results = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    if (!results.length) throw new Error('所有启用数据源均未返回可用内容')
    const items = results.flatMap(({ source, data }) => data.list.map((item: any) => ({ ...item, _source: source.name, _uid: `${source.name}-${item.vod_id}` })))
    mergeBrowseCategories(items)
    const entry: BrowseCacheEntry = {
      items,
      pageCount: Number(results[0]?.data.pagecount || 0),
      total: results.reduce((sum, result) => sum + Number(result.data.total || 0), 0),
      categories: browseCategories.value,
    }
    browseCache.set(cacheKey, entry)
    if (browseCache.size > 60) browseCache.delete(browseCache.keys().next().value as string)
    applyBrowseCache(entry)
  } catch (error) {
    if ((error as Error).name !== 'AbortError') browseError.value = error instanceof Error ? error.message : '加载分类内容失败'
  } finally {
    if (!controller.signal.aborted) browseLoading.value = false
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

const changeBrowsePage = (offset: number) => {
  const nextPage = browsePage.value + offset
  if (nextPage < 1 || nextPage > browsePageCount.value) return
  browsePage.value = nextPage
  saveBrowseVisit()
  loadBrowse()
}

watch(activeSources, sources => {
  if (sources.some(source => source.api === browseSourceApi.value)) return
  browseSourceApi.value = sources[0]?.api ?? ''
}, { immediate: true })
watch(browseSourceApi, () => {
  restoreBrowseVisit()
  loadBrowse()
})
watch(browseSort, saveBrowseVisit)

// ─── 状态 ────────────────────────────────────────────────────
const searchKeyword = ref('')
const videos = shallowRef<any[]>([])
const loading = ref(false)
const hasSearched = ref(false)
const doneCount = ref(0)
const failedSourceCount = ref(0)
const searchError = ref('')
const runQuerySearch = () => {
  const query = String(route.query.q || '').trim()
  if (!query) return
  searchKeyword.value = query
  activeTab.value = 'search'
  handleSearch()
}
watch(() => route.query.q, () => runQuerySearch())

// 图片代理 URL
const getProxyImageUrl = (url: string) => {
  if (!url) return ''
  return backend.proxyUrl(url)
}

// ─── 搜索历史 ─────────────────────────────────────────────────
const searchHistory = useStorage<string[]>('av_search_history', [])
const saveSearchHistory = (kw: string) => {
  searchHistory.value = [kw, ...searchHistory.value.filter(s => s !== kw)].slice(0, 20)
}
const removeSearchHistory = (kw: string) => {
  searchHistory.value = searchHistory.value.filter(s => s !== kw)
}

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
  playHistory.value = [record, ...playHistory.value.filter(item => item.url !== url)].slice(0, 30)
}

// ─── 收藏 ─────────────────────────────────────────────────────
const favorites = useStorage<any[]>('av_favorites', [])
const toggleFav = (video: any) => {
  const exists = favorites.value.find((f: any) => f._uid === video._uid)
  if (exists) favorites.value = favorites.value.filter((f: any) => f._uid !== video._uid)
  else favorites.value = [...favorites.value, video]
}
const isFav = (video: any) => favorites.value.some((f: any) => f._uid === video._uid)

// 播放器
const showPlayer = ref(false)
const playingVideo = ref<any>(null)
const playingUrl = ref('')
const videoEl = ref<HTMLVideoElement | null>(null)
const playingGroup = ref<{ vod_name: string; vod_pic: string; items: any[] } | null>(null)
const playerMessage = ref('')
const playbackRate = useStorage<number>('av_playback_rate', 1)
const volume = useStorage<number>('av_volume', 1)
const attemptedSourceIds = new Set<string>()
let switchingSource = false
let resumeTime = 0
let lastProgressSave = 0
let hls: Hls | null = null

// 增量去重合并 — 避免每次 videos 变化都重建整个 Map
const mergedMap = new Map<string, { key: string; vod_name: string; vod_pic: string; items: any[] }>()
const mergedVideos = shallowRef<{ key: string; vod_name: string; vod_pic: string; items: any[] }[]>([])

function rebuildMerged() {
  mergedMap.clear()
  for (const v of videos.value) {
    const key = v.vod_name.trim().toLowerCase()
    const existing = mergedMap.get(key)
    if (existing) {
      existing.items.push(v)
    } else {
      mergedMap.set(key, { key, vod_name: v.vod_name, vod_pic: v.vod_pic, items: [v] })
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
const fetchFromSource = async (source: AvSite, keyword: string, signal: AbortSignal): Promise<any[]> => {
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

const searchCache = new Map<string, { expiresAt: number; items: any[] }>()
const mapWithConcurrency = async <T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) => {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run))
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

  saveSearchHistory(keyword)
  loading.value = true
  hasSearched.value = true
  doneCount.value = 0
  failedSourceCount.value = 0
  searchError.value = ''
  videos.value = []
  rebuildMerged()

  const activeSources = getActiveSources()
  const cacheKey = `${keyword}|${activeSources.map(source => source.api).sort().join(',')}`
  const cached = searchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    videos.value = cached.items
    doneCount.value = activeSources.length
    rebuildMerged()
    loading.value = false
    return
  }

  // 限制并发请求，避免数据源较多时同时建立过多连接。
  const sourceResults = await mapWithConcurrency(activeSources, 4, async source => {
    const items = await fetchFromSource(source, keyword, signal)
    if (!signal.aborted) doneCount.value++
    return items
  })
  if (signal.aborted) return
  const allItems = sourceResults.flat()
  searchCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, items: allItems })
  if (searchCache.size > 30) searchCache.delete(searchCache.keys().next().value as string)
  videos.value = allItems
  rebuildMerged()

  if (!signal.aborted) {
    loading.value = false
    if (allItems.length === 0 && failedSourceCount.value > 0) searchError.value = '已启用的数据源暂时均不可用'
  }
}

// ─── 播放 ─────────────────────────────────────────────────────
const playVideo = async (video: any) => {
  if (!video.vod_play_url) return

  const episodes = video.vod_play_url.split('#').filter(Boolean).map((ep: string) => {
    const parts = ep.split('$')
    return { name: parts[0], url: parts[parts.length - 1] }
  })
  if (episodes.length === 0) return

  playingVideo.value = { ...video, episodes }
  // O(1) 查找合并组
  const found = findGroup(video.vod_name)
  playingGroup.value = found || { vod_name: video.vod_name, vod_pic: video.vod_pic, items: [video] }
  attemptedSourceIds.clear()
  attemptedSourceIds.add(video._uid)
  resumeTime = 0
  playerMessage.value = ''
  await window.api.player.open(episodes[0].url, video.vod_name)
}

const switchSource = async (video: any, automatic = false) => {
  if (!video.vod_play_url) return
  const episodes = video.vod_play_url.split('#').filter(Boolean).map((ep: string) => {
    const parts = ep.split('$')
    return { name: parts[0], url: parts[parts.length - 1] }
  })
  if (episodes.length === 0) return
  playingVideo.value = { ...video, episodes }
  attemptedSourceIds.add(video._uid)
  resumeTime = 0
  playerMessage.value = automatic ? `当前线路不可用，已切换到 ${video._source}` : ''
  await startPlay(episodes[0].url, episodes[0].name)
}

const tryNextSource = async () => {
  if (switchingSource) return
  const next = playingGroup.value?.items.find(item => !attemptedSourceIds.has(item._uid))
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

const startPlay = async (url: string, epName = '') => {
  playingUrl.value = url
  if (playingVideo.value) savePlayHistory(playingVideo.value, epName, url)

  // 等待 DOM 更新后直接获取 video 元素
  await nextTick()
  const el = videoEl.value
  if (!el) return

  applyPlaybackSettings()

  if (hls) { hls.destroy(); hls = null }
  el.pause()
  el.removeAttribute('src')
  el.load()

  // 支持 HLS 在线流和直链
  if (Hls.isSupported() && /\.m3u8(?:$|\?)/i.test(url)) {
    hls = new Hls()
    hls.loadSource(url)
    hls.attachMedia(el)
    hls.on(Hls.Events.MANIFEST_PARSED, () => el.play().catch(() => {}))
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) tryNextSource()
    })
  } else {
    el.src = url
    el.play().catch(() => {})
  }
}

const applyPlaybackSettings = () => {
  const el = videoEl.value
  if (!el) return
  el.playbackRate = Number(playbackRate.value) || 1
  el.volume = Math.min(1, Math.max(0, Number(volume.value) || 0))
}

const resumeHistory = async (record: AvPlayRecord) => {
  const video = record.video
  const episodes = video.episodes?.length
    ? video.episodes
    : video.vod_play_url?.split('#').filter(Boolean).map((ep: string) => {
      const parts = ep.split('$')
      return { name: parts[0], url: parts[parts.length - 1] }
    }) ?? []
  playingVideo.value = { ...video, episodes }
  playingGroup.value = findGroup(video.vod_name) || { vod_name: video.vod_name, vod_pic: video.vod_pic, items: [video] }
  attemptedSourceIds.clear()
  switchingSource = false
  attemptedSourceIds.add(video._uid)
  resumeTime = record.progress
  playerMessage.value = record.progress > 5 ? '继续上次播放' : ''
  await window.api.player.open(record.url, record.vod_name)
}

const handleLoadedMetadata = () => {
  const el = videoEl.value
  if (!el) return
  applyPlaybackSettings()
  if (resumeTime > 5 && resumeTime < el.duration - 10) el.currentTime = resumeTime
  resumeTime = 0
}

const handleTimeUpdate = () => {
  const el = videoEl.value
  if (!el || !playingVideo.value || !playingUrl.value || Date.now() - lastProgressSave < 1000) return
  lastProgressSave = Date.now()
  const record = playHistory.value.find(item => item.url === playingUrl.value)
  if (!record) return
  record.progress = el.currentTime
  record.duration = Number.isFinite(el.duration) ? el.duration : 0
  record.timestamp = Date.now()
}

const handleVideoError = () => {
  if (!hls) tryNextSource()
}

const handleVideoEnded = async () => {
  const episodes = playingVideo.value?.episodes ?? []
  const currentIndex = episodes.findIndex((episode: any) => episode.url === playingUrl.value)
  const next = currentIndex >= 0 ? episodes[currentIndex + 1] : null
  if (next) {
    playerMessage.value = `即将播放：${next.name}`
    await startPlay(next.url, next.name)
  } else {
    const groups = activeTab.value === 'search'
      ? mergedVideos.value
      : activeTab.value === 'browse'
        ? sortedBrowseVideos.value.map(video => ({ items: [video] }))
        : []
    const currentKey = playingVideo.value?.vod_name?.trim().toLowerCase()
    const currentIndex = groups.findIndex(group => group.items[0]?.vod_name?.trim().toLowerCase() === currentKey)
    const nextVideo = currentIndex >= 0 ? groups[currentIndex + 1]?.items[0] : null
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
    el.currentTime = Math.max(0, el.currentTime + (event.key === 'ArrowLeft' ? -10 : 10))
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
  if (hls) { hls.destroy(); hls = null }
  if (videoEl.value) videoEl.value.src = ''
}

const handleNavigateBack = (event: Event) => {
  if (!showPlayer.value) return
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
  if (hls) { hls.destroy(); hls = null }
})
onMounted(() => {
  window.addEventListener('app:navigate-back', handleNavigateBack)
  restoreBrowseVisit()
  loadBrowse()
  if (route.query.tab === 'search') runQuerySearch()
})
onBeforeUnmount(() => window.removeEventListener('app:navigate-back', handleNavigateBack))
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
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
