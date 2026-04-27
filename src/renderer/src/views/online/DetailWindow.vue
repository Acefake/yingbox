<template>
  <div class="detail-win">
    <!-- 悬浮窗口控制按钮 -->
    <WinControls class="dw-win-controls" />

    <!-- 加载中 -->
    <div v-if="loadingTmdb" class="dw-loading">
      <div class="dw-spinner" />
      <span>正在加载详情...</span>
    </div>

    <div v-else class="dw-body">
      <!-- 背景大图 -->
      <div class="dw-backdrop">
        <img v-if="tmdbDetail?.backdrop_path" :src="`https://images.tmdb.org/t/p/w1280${tmdbDetail.backdrop_path}`"
          class="dw-backdrop-img" />
        <div class="dw-backdrop-overlay" />
      </div>

      <!-- 内容 -->
      <div class="dw-content">
        <div class="dw-hero">
          <!-- 海报 -->
          <div class="dw-poster-wrap">
            <img :src="tmdbDetail?.poster_path
                ? `https://images.tmdb.org/t/p/w342${tmdbDetail.poster_path}`
                : itemPic
              " class="dw-poster" @error="onImgError" />
          </div>
          <!-- 信息 -->
          <div class="dw-info">
            <h1 class="dw-title">
              {{ tmdbDetail?.title || tmdbDetail?.name || itemName }}
            </h1>
            <h3 v-if="tmdbDetail?.original_title || tmdbDetail?.original_name" class="dw-orig-title">
              {{ tmdbDetail?.original_title || tmdbDetail?.original_name }}
            </h3>
            <div class="dw-meta-row">
              <span v-if="tmdbDetail?.vote_average" class="dw-rating">
                ★ {{ tmdbDetail.vote_average.toFixed(1) }}<em>/ 10</em>
              </span>
              <span v-if="tmdbDetail?.release_date || tmdbDetail?.first_air_date" class="dw-tag">
                {{
                  (
                    tmdbDetail.release_date ||
                    tmdbDetail.first_air_date ||
                    ''
                  ).slice(0, 4)
                }}
              </span>
              <span v-if="tmdbDetail?.runtime" class="dw-tag">{{ tmdbDetail.runtime }} 分钟</span>
              <span v-for="g in (tmdbDetail?.genres || []).slice(0, 4)" :key="g.id" class="dw-tag">{{ g.name }}</span>
              <span v-if="itemData?._source === 'catspider' || itemData?._source === 'cms'" class="dw-tag"
                :class="{ 'source-vod': itemData._source === 'catspider', 'source-cms': itemData._source === 'cms' }">
                {{ itemData._source === 'catspider' ? 'VOD' : 'CMS' }}
                <template v-if="itemData.source_name">· {{ itemData.source_name }}</template>
              </span>
              <span v-else-if="itemData?._source === 'douban'" class="dw-tag source-douban">
                豆瓣
              </span>
            </div>
            <p v-if="tmdbDetail?.overview || itemOverview" class="dw-overview">
              {{ tmdbDetail?.overview || itemOverview }}
            </p>
            <div class="dw-meta-table">
              <div v-if="directors.length" class="dw-meta-item">
                <span class="dw-meta-label">导演</span>
                <span class="dw-meta-val">{{ directors.join('、') }}</span>
              </div>
              <div v-if="(tmdbDetail?.production_countries || []).length" class="dw-meta-item">
                <span class="dw-meta-label">地区</span>
                <span class="dw-meta-val">{{
                  tmdbDetail.production_countries
                    .map((c: any) => c.name)
                    .join('、')
                }}</span>
              </div>
            </div>
            <!-- 播放源加载状态 -->
            <div v-if="searchingCms" class="dw-loading-sources">
              <span class="btn-spinner" />
              <span>正在搜索播放源...</span>
            </div>

            <!-- 播放源 -->
            <div v-if="episodeGroups.length" class="dw-sources-section">
              <h4 class="dw-section-title">播放源</h4>
              <!-- 来源分类 Tabs -->
              <div class="source-type-tabs">
                <button v-if="catSpiderGroups.length" class="source-type-tab"
                  :class="{ active: currentSourceType === 'catspider' }" @click="switchSourceType('catspider')">
                  VOD源
                </button>
                <button v-if="cmsGroups.length" class="source-type-tab" :class="{ active: currentSourceType === 'cms' }"
                  @click="switchSourceType('cms')">
                  CMS源
                </button>
              </div>
              <!-- 分组 Tabs -->
              <div class="group-tabs">
                <button v-for="(g, gi) in currentGroups" :key="gi" class="group-tab"
                  :class="{ active: activeGroup === gi, 'cs-tab': currentSourceType === 'catspider' }"
                  @click="switchGroup(gi)">
                  {{ g.label }}
                </button>
              </div>
              <!-- 播放列表 -->
              <div class="episode-list">
                <button v-for="ep in currentGroups[activeGroup]?.episodes" :key="ep.url" class="ep-btn"
                  :class="{ playing: currentUrl === ep.url }" @click="playEp(ep.url, ep.ext)">
                  {{ ep.name }}
                </button>
                <div v-if="!currentGroups[activeGroup]?.episodes?.length" class="ep-empty">
                  无可用剧集
                </div>
              </div>
            </div>
            <div v-else-if="!searchingCms && showPlaySheet" class="dw-sources-section">
              <div class="ep-empty">未找到可用播放源</div>
            </div>
          </div>
        </div>



        <!-- 演员 -->
        <div v-if="cast.length" class="dw-cast-section">
          <h4 class="dw-section-title">演员</h4>
          <div v-scroll-x class="dw-cast-list">
            <div v-for="actor in cast.slice(0, 14)" :key="actor.id" class="dw-actor">
              <img :src="actor.profile_path
                  ? `https://images.tmdb.org/t/p/w185${actor.profile_path}`
                  : ''
                " class="dw-actor-img" @error="onActorImgError" />
              <div class="dw-actor-name">{{ actor.name }}</div>
              <div class="dw-actor-char">{{ actor.character }}</div>
            </div>
          </div>
        </div>



        <!-- 图库 -->
        <div v-if="images.length" class="dw-gallery-section">
          <h4 class="dw-section-title">剧照</h4>
          <div v-scroll-x class="dw-gallery">
            <div v-for="(img, idx) in images.slice(0, 20)" :key="idx" class="dw-gallery-item"
              @click="lightboxIdx = idx">
              <img :src="`https://images.tmdb.org/t/p/w500${img.file_path}`" class="dw-gallery-img" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 图片灯箱 -->
    <Transition name="lb-fade">
      <div v-if="lightboxIdx !== null" class="lb-mask" @click.self="lightboxIdx = null">
        <button class="lb-arrow lb-prev" @click="
          lightboxIdx = (lightboxIdx! - 1 + images.length) % images.length
          ">
          ‹
        </button>
        <img :src="`https://images.tmdb.org/t/p/original${images[lightboxIdx!].file_path}`" class="lb-img" />
        <button class="lb-arrow lb-next" @click="lightboxIdx = (lightboxIdx! + 1) % images.length">
          ›
        </button>
        <button class="lb-close" @click="lightboxIdx = null">✕</button>
      </div>
    </Transition>

    <!-- 播放弹窗 -->
    <Transition name="sheet-fade">
      <div v-if="showPlaySheet" class="sheet-mask" @click.self="showPlaySheet = false">
        <div class="play-sheet">
          <div class="player-wrap">
            <video ref="videoEl" class="hls-player" controls autoplay :poster="tmdbDetail?.backdrop_path
                ? `https://images.tmdb.org/t/p/w1280${tmdbDetail.backdrop_path}`
                : ''
              " />
          </div>
          <div class="sheet-header">
            <span class="sheet-title">正在播放</span>
            <button class="sheet-close" @click="showPlaySheet = false">
              ✕
            </button>
          </div>
        </div>
      </div>
    </Transition>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import WinControls from '@/components/WinControls.vue'
import axios from 'axios'
import Hls from 'hls.js'
import { getTmdbAccessToken } from '@/stores/scrape-provider-store'
import {
  useOnlineSearch,
  type EpisodeGroup,
} from './composables/use-online-search'

const {
  fetchDetail,
  resolvePlayUrl,
  keyword,
} = useOnlineSearch()

const itemData = ref<any>(null)
const itemName = ref('')
const itemPic = ref('')
const itemType = ref('')
const itemOverview = ref('')
const searchTitle = ref('')

const tmdbDetail = ref<any>(null)
const cast = ref<any[]>([])
const directors = ref<string[]>([])
const images = ref<any[]>([])
const loadingTmdb = ref(true)
const lightboxIdx = ref<number | null>(null)

const searchingCms = ref(false)
const showPlaySheet = ref(false)
const episodeGroups = ref<EpisodeGroup[]>([])
const activeGroup = ref(0)
const currentSourceType = ref<'cms' | 'catspider'>('cms')
const currentUrl = ref('')

const catSpiderGroups = computed(() => episodeGroups.value.filter(g => g._source === 'catspider'))
const cmsGroups = computed(() => episodeGroups.value.filter(g => g._source === 'cms' || !g._source))
const currentGroups = computed(() => currentSourceType.value === 'catspider' ? catSpiderGroups.value : cmsGroups.value)
const videoEl = ref<HTMLVideoElement | null>(null)
let hls: Hls | null = null

const loadData = async (data: any) => {
  if (!data) return
  itemData.value = data
  itemName.value = data.vod_name || ''
  itemPic.value = data.vod_pic || ''
  itemType.value = data.type_name || ''
  itemOverview.value = data.overview || data.vod_content || data.vod_desc || ''
  searchTitle.value = data.searchTitle || data.vod_name || ''
  tmdbDetail.value = null
  cast.value = []
  directors.value = []
  images.value = []
  showPlaySheet.value = false
  episodeGroups.value = []
  currentUrl.value = ''
  const guessType: 'movie' | 'tv' = itemType.value.includes('剧')
    ? 'tv'
    : 'movie'
  await fetchTmdb(searchTitle.value || itemName.value, guessType)
  // 自动加载播放源
  await loadPlaySources()
}

onMounted(async () => {
  const data = await (window.api as any).detail.getData()
  await loadData(data)
    ; (window.api as any).detail.onUpdate((newData: unknown) => loadData(newData))
})

onBeforeUnmount(() => {
  ; (window.api as any).detail.offUpdate()
})

const fetchTmdb = async (name: string, mediaType: 'movie' | 'tv') => {
  loadingTmdb.value = true
  const token = getTmdbAccessToken()
  const headers = { Authorization: `Bearer ${token}` }
  try {
    const sr = await axios.get(
      `https://api.themoviedb.org/3/search/${mediaType}`,
      {
        params: { query: name, language: 'zh-CN', page: 1 },
        headers,
        timeout: 8000,
      }
    )
    const first = sr.data?.results?.[0]
    if (!first) return
    const id = first.id
    const [dr, cr] = await Promise.all([
      axios.get(`https://api.themoviedb.org/3/${mediaType}/${id}`, {
        params: { language: 'zh-CN' },
        headers,
        timeout: 8000,
      }),
      axios.get(`https://api.themoviedb.org/3/${mediaType}/${id}/credits`, {
        params: { language: 'zh-CN' },
        headers,
        timeout: 8000,
      }),
    ])
    tmdbDetail.value = dr.data
    cast.value = cr.data?.cast || []
    directors.value = (cr.data?.crew || [])
      .filter((c: any) => c.job === 'Director')
      .map((c: any) => c.name)
    const ir = await axios
      .get(`https://api.themoviedb.org/3/${mediaType}/${id}/images`, {
        headers,
        timeout: 8000,
      })
      .catch(() => null as null)
    images.value = (ir?.data?.backdrops || []).slice(0, 30)
  } catch {
    /* silent */
  } finally {
    loadingTmdb.value = false
  }
}

const loadPlaySources = async () => {
  searchingCms.value = true
  episodeGroups.value = []
  activeGroup.value = 0
  currentUrl.value = ''
  try {
    // 如果 item 来自 cms/catspider，直接获取其播放列表
    if (itemData.value?._source === 'cms' || itemData.value?._source === 'catspider') {
      const itemGroups = await fetchDetail(itemData.value)
      episodeGroups.value.push(...itemGroups)
      currentSourceType.value = itemData.value._source === 'catspider' ? 'catspider' : 'cms'
    } else {
      // 否则（豆瓣/播放历史），搜索所有源获取播放列表
      keyword.value = searchTitle.value
      const { search, results } = useOnlineSearch()
      await search(searchTitle.value)

      // 增量加载：每获取到一个源的结果立即展示
      for (const result of results.value) {
        const resultGroups = await fetchDetail(result)
        if (resultGroups.length) {
          episodeGroups.value.push(...resultGroups)
          // 首次有结果时自动设置默认源类型
          if (!currentSourceType.value || currentSourceType.value === 'cms') {
            const hasVod = episodeGroups.value.some(g => g._source === 'catspider')
            if (hasVod) currentSourceType.value = 'catspider'
          }
        }
      }

      // 最终确定默认源类型
      const hasVod = episodeGroups.value.some(g => g._source === 'catspider')
      currentSourceType.value = hasVod ? 'catspider' : 'cms'
    }
  } catch {
    /* silent */
  } finally {
    searchingCms.value = false
  }
}

const resolveUrl = async (url: string): Promise<string> => {
  if (url.match(/\.(m3u8|mp4|flv)/i)) return url
  try {
    const r = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 5,
      responseType: 'text',
    })
    const final: string = (r.request as any)?.responseURL || url
    if (final.match(/\.(m3u8|mp4)/i)) return final
    const m = String(r.data).match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i)
    if (m) return m[0]
  } catch {
    /* fallback */
  }
  return url
}

const switchSourceType = (type: 'cms' | 'catspider') => {
  currentSourceType.value = type
  activeGroup.value = 0
}

// For VOD sources, we need to know the siteName for resolvePlayUrl
const currentSiteName = computed(() => {
  if (currentSourceType.value === 'catspider') {
    return catSpiderGroups.value[activeGroup.value]?._siteName || ''
  }
  return ''
})

const switchGroup = (gi: number) => {
  activeGroup.value = gi
  const first = currentGroups.value[gi]?.episodes?.[0]
  if (first) playEp(first.url, first.ext)
}

const resolvingUrl = ref(false)

const playEp = async (url: string, ext?: Record<string, any>) => {
  // 先弹出播放器窗口
  showPlaySheet.value = true
  currentUrl.value = ''
  let playUrl = url
  // CatSpider episodes need resolvePlayUrl
  if (currentSourceType.value === 'catspider' && currentSiteName.value && ext) {
    resolvingUrl.value = true
    const resolved = await resolvePlayUrl(currentSiteName.value, ext)
    resolvingUrl.value = false
    if (resolved) playUrl = resolved
  }
  currentUrl.value = playUrl
}

watch(currentUrl, async url => {
  if (!url) return
  // 等待 DOM 渲染 video 元素
  await nextTick()
  let el = videoEl.value
  for (let i = 0; i < 10 && !el; i++) {
    await new Promise(r => setTimeout(r, 100))
    el = videoEl.value
  }
  if (!el) return
  if (hls) {
    hls.destroy()
    hls = null
  }
  const resolved = await resolveUrl(url)
  if (Hls.isSupported() && resolved.includes('.m3u8')) {
    hls = new Hls()
    hls.loadSource(resolved)
    hls.attachMedia(el)
    hls.on(Hls.Events.MANIFEST_PARSED, () => el.play().catch(() => { }))
  } else {
    el.src = resolved
    el.play().catch(() => { })
  }
})

onBeforeUnmount(() => {
  if (hls) {
    hls.destroy()
    hls = null
  }
})

const onImgError = (e: Event) => {
  ; (e.target as HTMLImageElement).src =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="140" height="210"><rect width="140" height="210" fill="%231f2937"/><text x="70" y="110" text-anchor="middle" fill="%236b7280" font-size="13">无封面</text></svg>'
}
const onActorImgError = (e: Event) => {
  ; (e.target as HTMLImageElement).src =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><circle cx="30" cy="30" r="30" fill="%23374151"/></svg>'
}
</script>

<style scoped>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.detail-win {
  width: 100vw;
  height: 100vh;
  background: #0d1117;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dw-win-controls {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 300;
}

.dw-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 13px;
}

.dw-spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: rgba(99, 102, 241, 0.8);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.dw-body {
  flex: 1;
  overflow-y: auto;
  position: relative;
}

.dw-body::-webkit-scrollbar {
  width: 4px;
}

.dw-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}

.dw-backdrop {
  position: relative;
  width: 100%;
  height: 360px;
  overflow: hidden;
}

.dw-backdrop-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
  filter: brightness(0.5);
}

.dw-backdrop-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom,
      rgba(13, 17, 23, 0) 20%,
      rgba(13, 17, 23, 1) 100%);
}

.dw-content {
  padding: 0 36px 36px;
  margin-top: -260px;
  position: relative;
}

.dw-hero {
  display: flex;
  gap: 28px;
  align-items: flex-start;
  margin-bottom: 32px;
}

.dw-poster-wrap {
  flex-shrink: 0;
  width: 220px;
}

.dw-poster {
  width: 220px;
  aspect-ratio: 2/3;
  object-fit: cover;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7);
  border: 2px solid rgba(255, 255, 255, 0.12);
}

.dw-info {
  flex: 1;
  min-width: 0;
}

.dw-title {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: 5px;
}

.dw-orig-title {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 12px;
}

.dw-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
  margin-bottom: 14px;
}

.dw-rating {
  font-size: 18px;
  font-weight: 700;
  color: #fbbf24;
}

.dw-rating em {
  font-size: 12px;
  font-style: normal;
  color: rgba(255, 255, 255, 0.35);
  margin-left: 3px;
}

.dw-tag {
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
}

.dw-tag.source-vod {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.dw-tag.source-cms {
  background: rgba(99, 102, 241, 0.2);
  color: #818cf8;
}

.dw-tag.source-douban {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.dw-overview {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.65);
  line-height: 1.75;
  margin-bottom: 18px;
}

.dw-meta-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 20px;
}

.dw-meta-item {
  display: flex;
  gap: 10px;
}

.dw-meta-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  width: 36px;
  flex-shrink: 0;
  margin-top: 1px;
}

.dw-meta-val {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
}

.dw-loading-sources {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.dw-sources-section {
  margin-top: 24px;
  padding: 16px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.ep-empty {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
  padding: 16px 0;
  text-align: center;
}

.btn-spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

.dw-section-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 12px;
}

.dw-cast-section {
  margin-bottom: 28px;
}

.dw-cast-list {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.dw-cast-list::-webkit-scrollbar {
  height: 3px;
}

.dw-cast-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
}

.dw-actor {
  flex-shrink: 0;
  width: 76px;
  text-align: center;
}

.dw-actor-img {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  margin: 0 auto 6px;
  display: block;
  background: #374151;
  border: 2px solid rgba(255, 255, 255, 0.08);
}

.dw-actor-name {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.8);
  line-height: 1.3;
}

.dw-actor-char {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 2px;
}

/* 图库 */
.dw-gallery-section {
  margin-bottom: 28px;
}

.dw-gallery {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.dw-gallery::-webkit-scrollbar {
  height: 3px;
}

.dw-gallery::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
}

.dw-gallery-item {
  flex-shrink: 0;
  width: 200px;
  height: 112px;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition:
    transform 0.15s,
    box-shadow 0.15s;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.dw-gallery-item:hover {
  transform: scale(1.03);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
}

.dw-gallery-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* 灯箱 */
.lb-fade-enter-active,
.lb-fade-leave-active {
  transition: opacity 0.2s;
}

.lb-fade-enter-from,
.lb-fade-leave-to {
  opacity: 0;
}

.lb-mask {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: rgba(0, 0, 0, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
}

.lb-img {
  max-width: 90vw;
  max-height: 86vh;
  border-radius: 8px;
  object-fit: contain;
}

.lb-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  font-size: 36px;
  width: 48px;
  height: 64px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.lb-arrow:hover {
  background: rgba(255, 255, 255, 0.2);
}

.lb-prev {
  left: 16px;
}

.lb-next {
  right: 16px;
}

.lb-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  border: none;
  color: white;
  font-size: 16px;
  cursor: pointer;
}

.lb-close:hover {
  background: rgba(239, 68, 68, 0.7);
}

/* 播放弹窗 */
.sheet-fade-enter-active,
.sheet-fade-leave-active {
  transition: opacity 0.2s;
}

.sheet-fade-enter-from,
.sheet-fade-leave-to {
  opacity: 0;
}

.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
}

.play-sheet {
  width: min(780px, 92vw);
  max-height: 85vh;
  background: #161b22;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
}

.sheet-header {
  display: flex;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  flex-shrink: 0;
}

.sheet-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
}

.sheet-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  font-size: 13px;
}

.sheet-close:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
}

.player-wrap {
  flex: 1;
  min-height: 300px;
  background: #000;
}

.hls-player {
  width: 100%;
  height: 100%;
  max-height: 65vh;
  display: block;
}

.source-type-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 10px;
}

.source-type-tab {
  padding: 6px 16px;
  font-size: 13px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all 0.2s;
}

.source-type-tab:hover {
  border-color: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.8);
}

.source-type-tab.active {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.5);
  color: #818cf8;
}

.group-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.group-tab {
  padding: 4px 14px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
}

.group-tab.active {
  background: rgba(99, 102, 241, 0.4);
  border-color: rgba(99, 102, 241, 0.6);
  color: white;
}

.group-tab.cs-tab.active {
  background: rgba(16, 185, 129, 0.4);
  border-color: rgba(16, 185, 129, 0.6);
}

.episode-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 130px;
  overflow-y: auto;
  padding-bottom: 12px;
}

.episode-list::-webkit-scrollbar {
  width: 3px;
}

.episode-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
}

.ep-btn {
  padding: 4px 13px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.15s;
}

.ep-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.ep-btn.playing {
  background: rgba(99, 102, 241, 0.4);
  border-color: rgba(99, 102, 241, 0.8);
  color: white;
}
</style>
