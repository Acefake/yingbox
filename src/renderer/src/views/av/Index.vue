<template>
  <div class="av-page h-full overflow-hidden bg-gray-900 text-white flex flex-col">
    <!-- Tab 导航 + 搜索栏 -->
    <div class="flex-shrink-0 bg-black/30 border-b border-white/10">
      <!-- Tab 行 -->
      <div class="flex items-center gap-1 px-4 pt-3 pb-0">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="px-5 py-2 rounded-t-lg text-sm transition-all border-b-2"
          :class="activeTab === tab.id
            ? 'bg-white/10 text-white font-semibold border-blue-500'
            : 'bg-transparent text-gray-400 border-transparent hover:text-white hover:bg-white/5'"
          @click="activeTab = tab.id"
        >{{ tab.label }}</button>
      </div>
      <!-- 搜索栏（仅聚合搜索 tab 显示） -->
      <div v-if="activeTab === 'search'" class="px-4 py-2">
        <div class="flex items-center gap-3">
          <input
            v-model="searchKeyword"
            type="text"
            placeholder="输入番号或关键词，聚合所有站点..."
            class="flex-1 max-w-xl bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            @keyup.enter="handleSearch"
          />
          <button
            @click="handleSearch"
            :disabled="loading"
            class="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          >
            {{ loading ? `搜索中 (${doneCount}/${avSources.length})` : '全站搜索' }}
          </button>
          <span v-if="mergedVideos.length > 0 && !loading" class="text-xs text-gray-400 whitespace-nowrap">{{ mergedVideos.length }} 部 / {{ videos.length }} 条</span>
        </div>
        <!-- 搜索记录 -->
        <div v-if="searchHistory.length" class="flex flex-wrap gap-2 mt-2">
          <span
            v-for="kw in searchHistory" :key="kw"
            class="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1 text-xs text-white/70 cursor-pointer transition-colors"
            @click="searchKeyword = kw; handleSearch()"
          >
            {{ kw }}
            <span class="text-white/30 hover:text-red-400 text-[10px]" @click.stop="removeSearchHistory(kw)">✕</span>
          </span>
          <button class="text-[11px] text-white/25 hover:text-white/60 ml-auto" @click="searchHistory = []">清空</button>
        </div>
      </div>
    </div>

    <!-- 聚合搜索内容 -->
    <div v-if="activeTab === 'search'" class="flex-1 overflow-y-auto p-4">
      <!-- 加载进度 -->
      <div v-if="loading" class="flex flex-col items-center justify-center py-8 gap-3">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <p class="text-sm text-gray-400">正在聚合 {{ avSources.length }} 个站点... ({{ doneCount }}/{{ avSources.length }})</p>
        <div class="w-64 bg-white/10 rounded-full h-1.5">
          <div class="bg-blue-500 h-1.5 rounded-full transition-all" :style="{ width: `${doneCount / avSources.length * 100}%` }"></div>
        </div>
      </div>
      <!-- 合并结果网格 -->
      <div v-if="mergedVideos.length > 0" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3" :class="{ 'mt-4': loading }">
        <div
          v-for="group in mergedVideos"
          :key="group.key"
          class="group rounded-lg overflow-hidden bg-white/5 hover:bg-white/10 transition-all hover:scale-[1.02] cursor-pointer"
          @click="playVideo(group.items[0])"
        >
          <div class="relative overflow-hidden bg-gray-800" style="aspect-ratio:16/9">
            <img :src="group.vod_pic" :alt="group.vod_name" class="w-full h-full object-contain bg-black" loading="lazy" @error="handleImageError" />
            <div class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
              <div class="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <svg class="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 5.84a.75.75 0 011.06.02l3.858 4.5a.75.75 0 010 .98l-3.858 4.5A.75.75 0 016 14.5V5.75a.75.75 0 01.3-.91z"/>
                </svg>
              </div>
            </div>
            <div v-if="group.items[0].vod_remarks" class="absolute bottom-1 right-1 bg-black/60 px-1.5 py-0.5 rounded text-[10px] text-white">{{ group.items[0].vod_remarks }}</div>
            <button class="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-black/50 text-xs transition-colors" :class="isFav(group.items[0]) ? 'text-yellow-400' : 'text-white/50 hover:text-yellow-400'" @click.stop="toggleFav(group.items[0])">{{ isFav(group.items[0]) ? '♥' : '♡' }}</button>
          </div>
          <div class="p-2">
            <h3 class="text-xs font-medium text-white truncate mb-1.5">{{ group.vod_name }}</h3>
            <!-- 来源列表 -->
            <div class="flex flex-wrap gap-1" @click.stop>
              <button
                v-for="item in group.items" :key="item._uid"
                class="px-1.5 py-0.5 rounded text-[9px] transition-colors bg-pink-600/60 hover:bg-pink-500 text-white"
                @click.stop="playVideo(item)"
              >{{ item._source }}</button>
            </div>
          </div>
        </div>
      </div>
      <!-- 空状态 -->
      <div v-else-if="hasSearched && !loading" class="flex flex-col items-center justify-center h-full text-gray-500">
        <p class="text-4xl mb-3">🔍</p>
        <p>未找到相关资源</p>
      </div>
      <!-- 初始引导 -->
      <div v-if="showHomePage && !searchHistory.length" class="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
        <p class="text-5xl mb-2">🎬</p>
        <p class="text-base">输入番号或关键词，聚合搜索全部站点</p>
        <p class="text-xs text-gray-600">共 {{ avSources.length }} 个资源站点</p>
      </div>
    </div>

    <!-- 收藏 Tab -->
    <div v-if="activeTab === 'fav'" class="flex-1 overflow-y-auto p-4">
      <div v-if="favorites.length">
        <div class="flex items-center gap-2 mb-4">
          <span class="text-sm text-white/50">共 {{ favorites.length }} 个收藏</span>
          <button class="text-[11px] text-white/30 hover:text-white/70 ml-auto" @click="favorites = []">清空全部</button>
        </div>
        <div class="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
          <div v-for="fav in favorites" :key="fav._uid" class="group cursor-pointer rounded-lg overflow-hidden bg-white/5 hover:bg-white/10 transition-all hover:scale-[1.02]" @click="playVideo(fav)">
            <div class="relative bg-gray-800" style="aspect-ratio:16/9">
              <img :src="fav.vod_pic" class="w-full h-full object-contain bg-black" @error="handleImageError" />
              <div class="absolute top-1 left-1 bg-pink-600/80 px-1 py-0.5 rounded text-[9px] text-white">{{ fav._source }}</div>
              <button class="absolute top-1 right-1 text-yellow-400 text-sm" @click.stop="toggleFav(fav)">♥</button>
            </div>
            <p class="text-[11px] px-1.5 py-1 truncate text-white/80">{{ fav.vod_name }}</p>
          </div>
        </div>
      </div>
      <div v-else class="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
        <p class="text-4xl mb-2">♡</p>
        <p>还没有收藏</p>
        <p class="text-xs">在搜索结果中点击 ♡ 收藏</p>
      </div>
    </div>

    <!-- 历史 Tab -->
    <div v-if="activeTab === 'history'" class="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
      <!-- 播放历史 -->
      <div>
        <div class="flex items-center gap-2 mb-3">
          <span class="text-sm font-semibold text-white/80">播放历史</span>
          <button class="text-[11px] text-white/30 hover:text-white/70 ml-auto" @click="playHistory = []">清空</button>
        </div>
        <div v-if="playHistory.length" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          <div v-for="rec in playHistory" :key="rec.url" class="flex items-center gap-3 bg-white/5 hover:bg-white/10 rounded-lg px-3 py-2 cursor-pointer transition-colors" @click="playVideo(rec.video)">
            <img :src="rec.vod_pic" class="w-12 h-12 object-cover rounded flex-shrink-0" @error="handleImageError" />
            <div class="min-w-0">
              <p class="text-sm text-white/80 truncate">{{ rec.vod_name }}</p>
              <p class="text-[11px] text-white/40">{{ rec.epName }} · {{ rec._source }}</p>
              <p class="text-[10px] text-white/25">{{ formatTime(rec.timestamp) }}</p>
            </div>
          </div>
        </div>
        <div v-else class="text-sm text-gray-500 py-4">暂无播放记录</div>
      </div>
    </div>

    <!-- 站点管理 -->
    <div v-if="activeTab === 'ext'" class="flex-1 overflow-y-auto px-4 py-2">
      <AvExtTab />
    </div>

    <!-- 播放器弹窗 -->
    <Transition name="sheet-fade">
      <div v-if="showPlayer" class="fixed inset-0 flex items-center justify-center bg-black/70" style="z-index: 1001" @click.self="closePlayer">
        <div class="flex flex-col rounded-xl overflow-hidden shadow-2xl bg-black" style="width: 80vw; max-width: 1000px;">
          <!-- 头部 -->
          <div class="flex items-center justify-between px-4 py-2.5 bg-gray-900 flex-shrink-0">
            <span class="text-sm font-medium text-white truncate max-w-[80%]">{{ playingVideo?.vod_name }}</span>
            <button @click="closePlayer" class="text-gray-400 hover:text-white text-lg leading-none px-1" style="-webkit-app-region: no-drag">✕</button>
          </div>
          <!-- 源切换 + 集数 -->
          <div class="bg-gray-900 px-4 py-2 flex flex-col gap-2 flex-shrink-0">
            <!-- 多源时显示 -->
            <div v-if="playingGroup && playingGroup.items.length > 1" class="flex items-center gap-2 flex-wrap">
              <span class="text-[11px] text-gray-500 flex-shrink-0">切换源:</span>
              <button
                v-for="item in playingGroup.items" :key="item._uid"
                class="px-2.5 py-0.5 rounded text-[11px] transition-colors"
                :class="playingVideo?._uid === item._uid ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'"
                @click="playVideo(item)"
              >{{ item._source }}</button>
            </div>
            <!-- 线路/清晰度/集数 -->
            <div v-if="playingVideo?.episodes?.length" class="flex items-center gap-2 flex-wrap max-h-24 overflow-y-auto">
              <span class="text-[11px] text-gray-500 flex-shrink-0">线路:</span>
              <button
                v-for="ep in playingVideo.episodes"
                :key="ep.url"
                @click="startPlay(ep.url, ep.name)"
                class="px-2.5 py-0.5 text-xs rounded transition-colors"
                :class="[
                  playingUrl === ep.url ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20',
                  isHdEp(ep.name) ? 'ring-1 ring-yellow-500/60' : ''
                ]"
              >
                {{ ep.name }}
                <span v-if="isHdEp(ep.name)" class="ml-0.5 text-yellow-400 text-[9px]">HD</span>
              </button>
            </div>
          </div>
          <!-- 视频 16:9 -->
          <div class="relative bg-black" style="aspect-ratio: 16/9">
            <video
              ref="videoEl"
              class="w-full h-full"
              controls
              autoplay
              :poster="playingVideo?.vod_pic"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import Hls from 'hls.js'
import { AV_SOURCES, useAvSources } from './use-av-sources'
import AvExtTab from './AvExtTab.vue'

// ─── Tab ─────────────────────────────────────────────────────
const tabs = [
  { id: 'search', label: '聚合搜索' },
  { id: 'fav', label: '收藏' },
  { id: 'history', label: '历史' },
  { id: 'ext', label: '站点管理' },
]
const activeTab = ref('search')

// ─── 站点（使用启用列表） ─────────────────────────────────────
const { getActiveSources } = useAvSources()
const avSources = AV_SOURCES

// ─── 状态 ────────────────────────────────────────────────────
const searchKeyword = ref('')
const videos = ref<any[]>([])
const loading = ref(false)
const hasSearched = ref(false)
const doneCount = ref(0)

// ─── 搜索历史 ─────────────────────────────────────────────────
const searchHistory = useStorage<string[]>('av_search_history', [])
const saveSearchHistory = (kw: string) => {
  searchHistory.value = [kw, ...searchHistory.value.filter(s => s !== kw)].slice(0, 20)
}
const removeSearchHistory = (kw: string) => {
  searchHistory.value = searchHistory.value.filter(s => s !== kw)
}

// ─── 播放历史 ─────────────────────────────────────────────────
const playHistory = useStorage<any[]>('av_play_history', [])
const savePlayHistory = (video: any, epName: string, url: string) => {
  const record = { vod_name: video.vod_name, vod_pic: video.vod_pic, _source: video._source, epName, url, timestamp: Date.now(), video }
  playHistory.value = [record, ...playHistory.value.filter((r: any) => r.url !== url)].slice(0, 30)
}

// ─── 收藏 ─────────────────────────────────────────────────────
const favorites = useStorage<any[]>('av_favorites', [])
const isFav = (video: any) => favorites.value.some((f: any) => f._uid === video._uid)
const toggleFav = (video: any) => {
  if (isFav(video)) {
    favorites.value = favorites.value.filter((f: any) => f._uid !== video._uid)
  } else {
    favorites.value = [video, ...favorites.value]
  }
}

// ─── 当前空状态时显示历史 ─────────────────────────────────────
const showHomePage = computed(() => !searchKeyword.value.trim() && !loading.value)

const mergedVideos = computed(() => {
  const map = new Map<string, { key: string; vod_name: string; vod_pic: string; items: any[] }>()
  for (const v of videos.value) {
    const key = v.vod_name.trim().toLowerCase()
    if (map.has(key)) {
      map.get(key)!.items.push(v)
    } else {
      map.set(key, { key, vod_name: v.vod_name, vod_pic: v.vod_pic, items: [v] })
    }
  }
  return Array.from(map.values())
})

const isHdEp = (name: string) =>
  /1080|720|4k|hd|高清|蓝光|blu/i.test(name)

const formatTime = (ts: number) => {
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

let currentAbort: AbortController | null = null

// 播放器
const showPlayer = ref(false)
const playingVideo = ref<any>(null)
const playingUrl = ref('')
const videoEl = ref<HTMLVideoElement | null>(null)
const playingGroup = ref<{ vod_name: string; vod_pic: string; items: any[] } | null>(null)
let hls: Hls | null = null

// ─── 单站请求（带超时） ──────────────────────────────────────
const fetchFromSource = async (source: typeof avSources[0], keyword: string, signal: AbortSignal): Promise<any[]> => {
  try {
    const url = keyword
      ? `${source.api}?ac=detail&wd=${encodeURIComponent(keyword)}`
      : `${source.api}?ac=detail`
    const timer = setTimeout(() => {}, 8000)
    const res = await fetch(url, { signal })
    clearTimeout(timer)
    const data = await res.json()
    if (data.code === 1 && Array.isArray(data.list)) {
      return data.list.map((v: any) => ({
        ...v,
        _source: source.name,
        _uid: `${source.name}-${v.vod_id}`,
      }))
    }
  } catch {
    // 超时、取消或失败静默跳过
  }
  return []
}

// ─── 全站并发聚合（仅使用已启用站点） ──────────────────────────────────
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchKeyword, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => handleSearch(), 400)
})

const handleSearch = async () => {
  if (currentAbort) currentAbort.abort()
  currentAbort = new AbortController()
  const signal = currentAbort.signal

  if (searchKeyword.value.trim()) saveSearchHistory(searchKeyword.value.trim())
  loading.value = true
  hasSearched.value = true
  doneCount.value = 0
  videos.value = []

  const activeSources = getActiveSources()
  await Promise.all(
    activeSources.map(async (source) => {
      const items = await fetchFromSource(source, searchKeyword.value.trim(), signal)
      if (signal.aborted) return
      doneCount.value++
      if (items.length > 0) {
        videos.value = [...videos.value, ...items]
      }
    })
  )

  if (!signal.aborted) loading.value = false
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
  // 找对应的合并组（搜索结果里找，找不到就单源）
  const key = video.vod_name.trim().toLowerCase()
  const found = mergedVideos.value.find(g => g.key === key)
  playingGroup.value = found || { vod_name: video.vod_name, vod_pic: video.vod_pic, items: [video] }
  showPlayer.value = true
  await startPlay(episodes[0].url, episodes[0].name)
}

const startPlay = async (url: string, epName = '') => {
  playingUrl.value = url
  if (playingVideo.value) savePlayHistory(playingVideo.value, epName, url)
  await nextTick()

  let el = videoEl.value
  for (let i = 0; i < 10 && !el; i++) {
    await new Promise(r => setTimeout(r, 100))
    el = videoEl.value
  }
  if (!el) return

  if (hls) { hls.destroy(); hls = null }

  if (Hls.isSupported() && url.includes('.m3u8')) {
    hls = new Hls()
    hls.loadSource(url)
    hls.attachMedia(el)
    hls.on(Hls.Events.MANIFEST_PARSED, () => el!.play().catch(() => {}))
  } else {
    el.src = url
    el.play().catch(() => {})
  }
}

const closePlayer = () => {
  showPlayer.value = false
  playingVideo.value = null
  playingUrl.value = ''
  if (hls) { hls.destroy(); hls = null }
  if (videoEl.value) videoEl.value.src = ''
}

// 图片加载失败
const handleImageError = (e: Event) => {
  const target = e.target as HTMLImageElement
  target.style.display = 'none'
}

onBeforeUnmount(() => { if (hls) { hls.destroy(); hls = null } })
onMounted(() => handleSearch())
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
