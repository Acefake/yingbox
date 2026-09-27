<template>
  <div class="detail-win">

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
                {{ itemData._source === 'catspider' ? '插件源' : 'CMS' }}
                <template v-if="itemData.source_name">· {{ itemData.source_name }}</template>
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
                  插件源{{ catSpiderGroups.length ? ` · ${catSpiderGroups.length}` : '' }}
                </button>
                <button v-if="cmsGroups.length" class="source-type-tab" :class="{ active: currentSourceType === 'cms' }"
                  @click="switchSourceType('cms')">
                  CMS源{{ cmsGroups.length ? ` · ${cmsGroups.length}` : '' }}
                </button>
              </div>
              <!-- 层级一：源 -->
              <div class="px-2 py-1 mb-1 yb-label">源</div>
              <div class="group-tabs">
                <button v-for="(sg, si) in siteGroups" :key="si" class="group-tab"
                  :class="{ active: activeSite === si, 'cs-tab': currentSourceType === 'catspider' }"
                  @click="switchSite(si)">
                  {{ sg.siteName }}
                </button>
              </div>
              <!-- 层级二：线路（多条时才显示） -->
              <template v-if="siteGroups[activeSite]?.lines.length > 1">
                <div class="px-2 py-1 mb-1 mt-2 yb-label">线路</div>
                <div class="group-tabs">
                  <button v-for="(line, li) in siteGroups[activeSite].lines" :key="li" class="group-tab"
                    :class="{ active: activeLine === li }"
                    @click="switchLine(li)">
                    {{ line.label }}
                  </button>
                </div>
              </template>
              <!-- 层级三：播放列表 -->
              <div class="px-2 py-1 mb-1 mt-2 yb-label">播放列表</div>
              <div class="episode-list">
                <button v-for="ep in currentEpisodes" :key="ep.url" class="ep-btn"
                  :class="{ playing: currentUrl === ep.url }" @click="playEp(ep.url, ep.ext)">
                  {{ ep.name }}
                </button>
                <div v-if="!currentEpisodes.length" class="ep-empty">
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
            <UnifiedVideoPlayer
              :src="currentUrl"
              :resolve-url="resolveUrl"
              :poster="tmdbDetail?.backdrop_path
                ? `https://images.tmdb.org/t/p/w1280${tmdbDetail.backdrop_path}`
                : ''"
              :title="itemName"
              closable
              @ready="videoEl = $event"
              @close="showPlaySheet = false"
            />
          </div>
        </div>
      </div>
    </Transition>

  </div>
</template>

<script setup lang="ts">
import { readStoredArray, saveStoredArray } from '@/utils/storage'
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { getTmdbAccessToken } from '@/stores/scrape-provider-store'
import UnifiedVideoPlayer from '@/components/UnifiedVideoPlayer.vue'
import {
  type PlayerSourceItem,
  canOpenElectronPlayer,
  openMediaPlayer,
} from '@/composables/use-media-player'
import { getMediaProgress } from '@/utils/play-progress'
import { message } from 'ant-design-vue'
import {
  type EpisodeGroup,
  useOnlineSearch,
} from './composables/use-online-search'

const {
  fetchDetail,
  resolvePlayUrl,
  keyword,
  search,
} = useOnlineSearch()

const props = defineProps<{ item?: unknown }>()

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

// 三层结构：站点 → 线路 → 播放列表
const activeSite = ref(0)
const activeLine = ref(0)

interface SiteGroup {
  siteName: string
  lines: EpisodeGroup[]
}
const siteGroups = computed((): SiteGroup[] => {
  const map = new Map<string, EpisodeGroup[]>()
  for (const g of currentGroups.value) {
    const key = g._siteName || g.label
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(g)
  }
  return Array.from(map.entries()).map(([siteName, lines]) => ({ siteName, lines }))
})

const currentEpisodes = computed(() =>
  siteGroups.value[activeSite.value]?.lines[activeLine.value]?.episodes || []
)

const currentLineGroup = computed(() =>
  siteGroups.value[activeSite.value]?.lines[activeLine.value]
)
const videoEl = ref<HTMLVideoElement | null>(null)

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
  await loadData(props.item)
})

watch(() => props.item, (data) => {
  if (data) loadData(data)
})

const fetchTmdb = async (name: string, mediaType: 'movie' | 'tv') => {
  loadingTmdb.value = true
  const token = getTmdbAccessToken()
  if (!token) {
    console.warn('[TMDB] 未配置 Access Token，已跳过 TMDB 查询（请在设置中填写）')
    loadingTmdb.value = false
    return
  }
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
    // 先保留打开详情时命中的条目，然后按片名检索全部已启用源，
    // 每个站点只取最匹配的一条，避免同一站点重复请求和重复线路。
    const directItem = itemData.value?._source === 'cms' || itemData.value?._source === 'catspider'
      ? itemData.value
      : null
    const normalizeTitle = (value: unknown) => String(value || '')
      .toLowerCase()
      .replace(/\[[^\]]*\]|\([^)]*\)|（[^）]*）/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '')
    const targetTitle = normalizeTitle(searchTitle.value)
    const sourceKey = (value: any) => `${value?._source || 'unknown'}:${value?._siteName || value?.api_url || value?.vod_id || ''}`
    const seenSources = new Set<string>()
    const pendingDetails = new Set<Promise<void>>()
    const appendDetail = (candidate: any) => {
      const key = sourceKey(candidate)
      if (seenSources.has(key)) return
      seenSources.add(key)
      const task = fetchDetail(candidate)
        .then(groups => {
          const available = groups.filter(group => group.episodes?.length)
          if (!available.length) return
          const hadGroups = episodeGroups.value.length > 0
          episodeGroups.value = [...episodeGroups.value, ...available]
          if (!hadGroups) {
            currentSourceType.value = available.some(group => group._source === 'catspider') ? 'catspider' : 'cms'
          }
        })
        .catch(() => undefined)
      pendingDetails.add(task)
      void task.finally(() => pendingDetails.delete(task))
    }

    // 当前命中的来源与全量搜索同时开始，并在任一来源完成后立即展示。
    if (directItem) appendDetail(directItem)
    keyword.value = searchTitle.value
    // 详情页只查询用户已启用的插件源，避免强制遍历整份插件清单导致长时间转圈。
    await search(searchTitle.value, {
      allVod: false,
      onItems: items => {
        for (const resultAny of items as any[]) {
          const title = normalizeTitle(resultAny?.vod_name || resultAny?.title || resultAny?.name)
          if (!title || !targetTitle || !(title === targetTitle || title.includes(targetTitle) || targetTitle.includes(title))) continue
          appendDetail(resultAny)
        }
      },
    })
    // 搜索结束后仍可能有详情请求在路上，等待它们完成以准确结束加载状态。
    await Promise.all([...pendingDetails])

    const hasVod = episodeGroups.value.some(g => g._source === 'catspider')
    currentSourceType.value = hasVod ? 'catspider' : 'cms'
  } catch {
    /* silent */
  } finally {
    searchingCms.value = false
    activeSite.value = 0
    activeLine.value = 0
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
  activeSite.value = 0
  activeLine.value = 0
}

// For VOD sources, we need to know the siteName for resolvePlayUrl
const currentSiteName = computed(() => {
  if (currentSourceType.value === 'catspider') {
    return currentLineGroup.value?._siteName || catSpiderGroups.value[activeGroup.value]?._siteName || ''
  }
  return ''
})

const switchSite = (si: number) => {
  activeSite.value = si
  activeLine.value = 0
  activeGroup.value = 0
}

const switchLine = (li: number) => {
  activeLine.value = li
}

const resolvingUrl = ref(false)
let playGeneration = 0
watch(showPlaySheet, visible => { if (!visible) { playGeneration++; resolvingUrl.value = false } })

/** 当前线路的播放队列：独立播放窗用它自动连播下一集 */
const buildPlaylist = (): PlayerSourceItem[] => {
  const line = siteGroups.value[activeSite.value]?.lines[activeLine.value]
  if (!line?.episodes?.length) return []
  return line.episodes.map(ep => ({
    url: ep.url,
    ...(ep.name ? { name: ep.name } : {}),
    ...(ep.ext ? { ext: ep.ext } : {}),
    ...(line._siteName ? { siteName: line._siteName } : {}),
  }))
}

/** 同集其它线路：当前线路播放失败时自动尝试 */
const buildFallbacks = (epName: string, epIndex: number): PlayerSourceItem[] => {
  const currentLine = siteGroups.value[activeSite.value]?.lines[activeLine.value]
  const out: PlayerSourceItem[] = []
  const seen = new Set<string>()

  const push = (line: EpisodeGroup, hit: { url: string; ext?: Record<string, any> }, sg: SiteGroup): void => {
    if (!hit?.url) return
    const key = `${line.label}|${hit.url}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      url: hit.url,
      name: `${sg.siteName} · ${line.label}`,
      ...(hit.ext ? { ext: hit.ext } : {}),
      ...(line._siteName ? { siteName: line._siteName } : {}),
    })
  }

  for (const sg of siteGroups.value) {
    for (const line of sg.lines) {
      if (line === currentLine) continue
      const eps = line.episodes || []
      if (!eps.length) continue
      // 优先按集名匹配；各源命名差异大（"第01集" vs "01"），失败时退化为按集序匹配
      const byName = epName ? eps.find(ep => ep.name === epName) : undefined
      const hit = byName || (epIndex >= 0 && epIndex < eps.length ? eps[epIndex] : undefined)
      if (hit) push(line, hit, sg)
    }
  }
  return out
}

const playEp = async (url: string, ext?: Record<string, any>) => {
  const generation = ++playGeneration
  currentUrl.value = ''
  let playUrl = url
  // CatSpider episodes need resolvePlayUrl
  if (currentSourceType.value === 'catspider' && currentSiteName.value && ext) {
    resolvingUrl.value = true
    const resolved = await resolvePlayUrl(currentSiteName.value, ext)
    if (generation !== playGeneration) return
    resolvingUrl.value = false
    if (resolved) playUrl = resolved
  }
  if (generation !== playGeneration) return

  // 预解析跳转/页面内 m3u8，便于 Electron 独立窗口直接播放
  resolvingUrl.value = true
  try {
    playUrl = await resolveUrl(playUrl)
  } finally {
    if (generation === playGeneration) resolvingUrl.value = false
  }
  if (generation !== playGeneration) return

  currentUrl.value = playUrl
  const historyKey = 'online_play_history'
  const history = readStoredArray<Record<string, any>>(historyKey)
  const mediaKey =
    String(itemData.value?.vod_id || itemData.value?.vod_name || itemName.value || playUrl)
  const prevProgress = getMediaProgress(playUrl)
  const record = {
    ...(itemData.value || {}),
    item: itemData.value,
    epName: ext?.name || '正在播放',
    url: playUrl,
    progress: prevProgress,
    groupLabel: currentSourceType.value === 'catspider' ? '插件源' : 'CMS',
    timestamp: Date.now(),
  }
  // 同一部片只保留一条最近记录（记住上次资源/集数）
  saveStoredArray(
    historyKey,
    [
      record,
      ...history.filter((entry: any) => {
        const key = String(entry?.item?.vod_id || entry?.vod_id || entry?.item?.vod_name || entry?.vod_name || entry?.url || '')
        return key && key !== mediaKey && entry?.url !== playUrl
      }),
    ].slice(0, 30)
  )

  const title = [itemName.value, ext?.name].filter(Boolean).join(' · ') || itemName.value || '正在播放'
  // 首页/在线：Electron 下强制独立播放窗，不再退回页内 sheet
  if (canOpenElectronPlayer()) {
    const startAt = getMediaProgress(playUrl)
    // 带上当前线路的剧集队列与同集备用线路：播放器据此自动连播/失败换线路
    const playlist = buildPlaylist()
    const epIndex = playlist.findIndex(item => item.url === url)
    const fallbacks = buildFallbacks(ext?.name || '', epIndex)
    const ok = await openMediaPlayer({
      url: playUrl,
      title,
      poster: itemPic.value || undefined,
      startAt,
      ...(playlist.length ? { playlist, index: epIndex >= 0 ? epIndex : 0 } : {}),
      ...(fallbacks.length ? { fallbacks } : {}),
    })
    showPlaySheet.value = false
    if (!ok) {
      message.error('无法打开独立播放窗口，请完全重启应用后再试')
    }
    return
  }
  // 非 Electron（纯网页）才用页内播放层
  showPlaySheet.value = true
}

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
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-sans);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dw-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--text-tertiary);
  font-size: 13px;
}

.dw-spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid var(--border-subtle);
  border-top-color: var(--accent);
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
  background: var(--scrollbar-thumb);
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
      transparent 20%,
      var(--bg-base) 100%);
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
  border: 2px solid var(--border-default);
}

.dw-info {
  flex: 1;
  min-width: 0;
}

.dw-title {
  font-size: 30px;
  font-weight: var(--font-weight-bold);
  line-height: 1.2;
  margin-bottom: 5px;
  color: var(--text-primary);
  letter-spacing: -0.022em;
}

.dw-orig-title {
  font-size: 16px;
  color: var(--text-tertiary);
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
  color: var(--warning);
}

.dw-rating em {
  font-size: 12px;
  font-style: normal;
  color: var(--text-tertiary);
  margin-left: 3px;
}

.dw-tag {
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 12px;
  background: var(--bg-fill-secondary);
  color: var(--text-secondary);
}

.dw-tag.source-vod {
  background: color-mix(in srgb, var(--success) 20%, transparent);
  color: var(--success);
}

.dw-tag.source-cms {
  background: var(--accent-soft);
  color: var(--accent-text);
}

.dw-tag.source-douban {
  background: color-mix(in srgb, var(--success) 20%, transparent);
  color: var(--success);
}

.dw-overview {
  font-size: 13px;
  color: var(--text-secondary);
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
  color: var(--text-tertiary);
  width: 36px;
  flex-shrink: 0;
  margin-top: 1px;
}

.dw-meta-val {
  font-size: 12px;
  color: var(--text-secondary);
}

.dw-loading-sources {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-secondary);
}

.dw-sources-section {
  margin-top: 24px;
  padding: 16px 0;
  border-top: 1px solid var(--separator);
}

.ep-empty {
  font-size: 13px;
  color: var(--text-tertiary);
  padding: 16px 0;
  text-align: center;
}

.btn-spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  border-top-color: var(--text-primary);
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

.dw-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
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
  background: var(--scrollbar-thumb);
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
  background: var(--bg-fill-secondary);
  border: 2px solid var(--border-subtle);
}

.dw-actor-name {
  font-size: 10px;
  color: var(--text-primary);
  line-height: 1.3;
}

.dw-actor-char {
  font-size: 10px;
  color: var(--text-tertiary);
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
  background: var(--scrollbar-thumb);
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
  border: 1px solid var(--border-subtle);
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
  background: var(--bg-fill-secondary);
  border: none;
  color: var(--text-on-accent);
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
  background: var(--scrollbar-thumb-hover);
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
  background: var(--bg-fill-secondary);
  border: none;
  color: var(--text-on-accent);
  font-size: 16px;
  cursor: pointer;
}

.lb-close:hover {
  background: color-mix(in srgb, var(--danger) 70%, transparent);
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
  width: min(1200px, 92vw);
  height: 78vh;
  max-height: 92vh;
  background: var(--bg-elevated);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
}

.player-wrap {
  flex: 1;
  min-height: 0;
  height: 100%;
  background: #000;
}

.source-type-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--separator);
  padding-bottom: 10px;
}

.source-type-tab {
  padding: 6px 16px;
  font-size: 13px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.2s;
}

.source-type-tab:hover {
  border-color: var(--text-tertiary);
  color: var(--text-primary);
}

.source-type-tab.active {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
  color: var(--accent-text);
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
  background: var(--bg-fill-tertiary);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
}

.group-tab.active {
  background: color-mix(in srgb, var(--accent) 40%, transparent);
  border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  color: var(--text-on-accent);
}

.group-tab.cs-tab.active {
  background: color-mix(in srgb, var(--success) 40%, transparent);
  border-color: color-mix(in srgb, var(--success) 60%, transparent);
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
  background: var(--scrollbar-thumb-hover);
}

.ep-btn {
  padding: 4px 13px;
  font-size: 12px;
  background: var(--bg-fill-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.ep-btn:hover {
  background: var(--scrollbar-thumb);
}

.ep-btn.playing {
  background: color-mix(in srgb, var(--accent) 40%, transparent);
  border-color: color-mix(in srgb, var(--accent) 80%, transparent);
  color: var(--text-on-accent);
}
</style>
