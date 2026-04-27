<template>
  <div class="vod-test-window">
    <div class="test-container">
      <h2 class="test-title">VOD 解析器测试</h2>

      <!-- Step 1: Browse / Search -->
      <div class="test-form">
        <h3 class="step-title">1. 浏览 / 搜索</h3>
        <div class="form-row">
          <div class="form-group">
            <label>站点</label>
            <select v-model="siteName" class="form-input" @change="handleSiteChange">
              <option v-for="s in sites" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="form-group flex-1">
            <label>关键词</label>
            <div class="input-row">
              <input v-model="keyword" type="text" class="form-input" placeholder="输入搜索关键词" @keyup.enter="handleSearch" />
              <button @click="handleSearch" :disabled="loading" class="test-button small">
                {{ loading ? '...' : '搜索' }}
              </button>
            </div>
          </div>
        </div>
        <!-- Category tabs from getConfig -->
        <div v-if="siteTabs.length" class="tab-row">
          <button
            v-for="(tab, ti) in siteTabs"
            :key="ti"
            class="tab-btn"
            :class="{ active: activeTab === ti }"
            @click="handleTabClick(ti)"
          >
            {{ tab.name }}
          </button>
        </div>
      </div>

      <!-- Search Results -->
      <div v-if="searchResults.length" class="test-result">
        <h3 class="result-title">搜索结果 ({{ searchResults.length }})</h3>
        <div class="result-list">
          <div
            v-for="(item, i) in searchResults"
            :key="i"
            class="result-card"
            :class="{ selected: selectedCard === i }"
            @click="selectCard(i)"
          >
            <img v-if="item.vod_pic" :src="item.vod_pic" class="card-img" />
            <div class="card-info">
              <div class="card-name">{{ item.vod_name }}</div>
              <div v-if="item.vod_remarks" class="card-remarks">{{ item.vod_remarks }}</div>
              <div v-if="item.ext?.url" class="card-url">{{ item.ext.url }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 2: Tracks -->
      <div v-if="selectedCard !== null && searchResults[selectedCard]" class="test-form">
        <h3 class="step-title">2. 剧集列表</h3>
        <button @click="handleGetTracks" :disabled="loading" class="test-button">
          {{ loading ? '...' : '获取剧集' }}
        </button>
      </div>

      <!-- Browse by category (only when no results) -->
      <div v-if="!searchResults.length && !siteTabs.length" class="test-form">
        <h3 class="step-title">浏览</h3>
        <button @click="handleSiteChange" :disabled="loading" class="test-button">
          {{ loading ? '...' : '加载站点分类' }}
        </button>
      </div>

      <div v-if="trackGroups.length" class="test-result">
        <h3 class="result-title">剧集</h3>
        <div v-for="(group, gi) in trackGroups" :key="gi" class="track-group">
          <div class="group-title">{{ group.title }}</div>
          <div class="track-list">
            <button
              v-for="(track, ti) in group.tracks"
              :key="ti"
              class="track-btn"
              :class="{ active: selectedTrack === `${gi}-${ti}` }"
              @click="selectTrack(gi, ti)"
            >
              {{ track.name }}
            </button>
          </div>
        </div>
      </div>

      <!-- Step 3: Play -->
      <div v-if="selectedTrackExt" class="test-form">
        <h3 class="step-title">3. 播放</h3>
        <button @click="handleGetPlayinfo" :disabled="loading" class="test-button">
          {{ loading ? '...' : '获取播放地址' }}
        </button>
      </div>

      <div v-if="playResult" class="test-result">
        <h3 class="result-title">播放结果</h3>
        <div class="result-content">
          <div class="result-item">
            <span class="result-label">success:</span>
            <span :class="playResult.success ? 'success' : 'error'">
              {{ playResult.success ? '是' : '否' }}
            </span>
          </div>
          <div v-if="playResult.error" class="result-item">
            <span class="result-label">错误:</span>
            <span class="result-value error">{{ playResult.error }}</span>
          </div>
          <div v-if="playUrls.length" class="result-item">
            <video
              ref="videoPlayer"
              controls
              class="video-player"
            />
          </div>
          <div v-if="playUrls.length" class="result-item">
            <span class="result-label">地址:</span>
            <span class="result-value break-all">{{ playUrls[0] }}</span>
          </div>
          <div v-if="!playUrls.length" class="result-item">
            <span class="result-label">data:</span>
            <span class="result-value break-all">{{ JSON.stringify(playResult.data) }}</span>
          </div>
        </div>
      </div>

      <!-- Raw JSON Debug -->
      <div v-if="lastRaw" class="test-result">
        <h3 class="result-title" @click="showRaw = !showRaw" style="cursor:pointer">
          原始响应 (点击{{ showRaw ? '隐藏' : '展开' }})
        </h3>
        <pre v-if="showRaw" class="raw-json">{{ lastRaw }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import Hls from 'hls.js'
import { useVODParser } from '@/composables/use-vod-parser'

const sites = [
  '哔滴影视', '欧乐🪜', '在线之家', 'LIBVIO',
  'ギリギリ动漫', '独播库', 'AGE动漫', '4k-av',
  '韓劇看看', '金牌影院', '燒火電影', 'NO視頻',
  '星芽短劇', '瓜子', '愛壹帆', '影视天堂',
  '嗷嗚動漫', '荐片', '人人', 'anime1',
  '农民影视', '七色番動漫', '茶杯狐', '路漫漫',
  'ppnix', '河馬短劇', '壹影視',
]

const { loading, search, getCards, getTracks, getPlayinfo, getConfig } = useVODParser()

const siteName = ref('NO視頻')
const keyword = ref('')
const searchResults = ref([])
const selectedCard = ref(null)
const trackGroups = ref([])
const selectedTrack = ref(null)
const playResult = ref(null)
const videoPlayer = ref(null)
const lastRaw = ref(null)
const showRaw = ref(false)
const siteTabs = ref([])
const activeTab = ref(0)
const siteBaseUrl = ref('')

const selectedTrackExt = computed(() => {
  if (!selectedTrack.value) return null
  const [gi, ti] = selectedTrack.value.split('-').map(Number)
  return trackGroups.value[gi]?.tracks[ti]?.ext || null
})

const playUrls = computed(() => {
  if (!playResult.value) return []
  const d = playResult.value.data
  // CatSpider format: data.urls[]
  if (d?.urls?.length) return d.urls
  // Nested: data.data.urls[]
  if (d?.data?.urls?.length) return d.data.urls
  // Direct url
  if (playResult.value.url) return [playResult.value.url]
  return []
})

// HLS player setup
let hlsInstance = null

watch(playUrls, async (urls) => {
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null }
  if (!urls.length) return
  await nextTick()
  const video = videoPlayer.value
  if (!video) return
  const src = urls[0]
  if (src.includes('.m3u8')) {
    if (Hls.isSupported()) {
      hlsInstance = new Hls({ maxBufferLength: 30 })
      hlsInstance.loadSource(src)
      hlsInstance.attachMedia(video)
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => { video.play() })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      video.play()
    }
  } else {
    video.src = src
    video.play()
  }
})

const handleSiteChange = async () => {
  siteTabs.value = []
  activeTab.value = 0
  searchResults.value = []
  selectedCard.value = null
  trackGroups.value = []
  selectedTrack.value = null
  playResult.value = null

  const result = await getConfig(siteName.value)
  lastRaw.value = JSON.stringify(result, null, 2)
  if (result.success && result.data) {
    const config = result.data.data || result.data
    siteTabs.value = config.tabs || []
    siteBaseUrl.value = config.site || ''
    // Auto-load first tab
    if (siteTabs.value.length) {
      handleTabClick(0)
    }
  }
}

const handleTabClick = async (ti) => {
  activeTab.value = ti
  searchResults.value = []
  selectedCard.value = null
  trackGroups.value = []
  selectedTrack.value = null
  playResult.value = null

  const tab = siteTabs.value[ti]
  if (!tab) return
  const ext = tab.ext || {}
  const result = await getCards({ siteName: siteName.value, ...ext, page: 1 })
  lastRaw.value = JSON.stringify(result, null, 2)
  if (result.success && result.data?.list) {
    searchResults.value = result.data.list
  } else if (result.success && result.data?.data?.list) {
    searchResults.value = result.data.data.list
  }
}

const handleSearch = async () => {
  if (!keyword.value.trim()) return
  searchResults.value = []
  selectedCard.value = null
  trackGroups.value = []
  selectedTrack.value = null
  playResult.value = null

  const result = await search({ siteName: siteName.value, keyword: keyword.value })
  lastRaw.value = JSON.stringify(result, null, 2)
  if (result.success && result.data?.list) {
    searchResults.value = result.data.list
  } else if (result.success && result.data?.data?.list) {
    searchResults.value = result.data.data.list
  }
}

const selectCard = (i) => {
  selectedCard.value = i
  trackGroups.value = []
  selectedTrack.value = null
  playResult.value = null
}

const handleGetTracks = async () => {
  if (selectedCard.value === null) return
  const card = searchResults.value[selectedCard.value]
  const url = card?.ext?.url
  if (!url) return

  trackGroups.value = []
  selectedTrack.value = null
  playResult.value = null

  const result = await getTracks({ siteName: siteName.value, url })
  lastRaw.value = JSON.stringify(result, null, 2)
  if (result.success && result.data?.list) {
    trackGroups.value = result.data.list
  } else if (result.success && result.data?.data?.list) {
    trackGroups.value = result.data.data.list
  }
}

const selectTrack = (gi, ti) => {
  selectedTrack.value = `${gi}-${ti}`
  playResult.value = null
}

const handleGetPlayinfo = async () => {
  if (!selectedTrackExt.value) return
  playResult.value = null

  // Pass the full ext object - some sites use url, others use vid/pkey/ref
  const extData = selectedTrackExt.value
  const url = extData.url || ''
  const result = await getPlayinfo({ siteName: siteName.value, url, ...extData })
  lastRaw.value = JSON.stringify(result, null, 2)
  playResult.value = result
}
</script>

<style scoped>
.vod-test-window {
  min-height: 100vh;
  max-height: 100vh;
  overflow-y: auto;
  background: #0d1117;
  color: #c9d1d9;
  padding: 24px;
}

.test-container {
  max-width: 900px;
  margin: 0 auto;
}

.test-title {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 24px;
  color: #fff;
}

.step-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #58a6ff;
}

.test-form {
  background: rgba(22, 27, 34, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-group {
  margin-bottom: 12px;
}

.form-group.flex-1 {
  flex: 1;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #8b949e;
}

.form-input {
  width: 100%;
  padding: 8px 12px;
  background: #0d1117;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #c9d1d9;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-color: #58a6ff;
}

.input-row {
  display: flex;
  gap: 8px;
}

.tab-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.tab-btn {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: #c9d1d9;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.tab-btn:hover {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
}

.tab-btn.active {
  border-color: #58a6ff;
  background: rgba(88, 166, 255, 0.15);
  color: #58a6ff;
}

.video-player {
  width: 100%;
  max-height: 400px;
  border-radius: 8px;
  background: #000;
  margin: 8px 0;
}

.break-all {
  word-break: break-all;
}

.test-button {
  padding: 8px 20px;
  background: #238636;
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.test-button.small {
  padding: 8px 16px;
}

.test-button:hover:not(:disabled) {
  background: #2ea043;
}

.test-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.test-result {
  background: rgba(22, 27, 34, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}

.result-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #fff;
}

.result-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.result-card {
  display: flex;
  gap: 10px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: all 0.2s;
}

.result-card:hover {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.04);
}

.result-card.selected {
  border-color: #58a6ff;
  background: rgba(88, 166, 255, 0.1);
}

.card-img {
  width: 50px;
  height: 70px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

.card-info {
  min-width: 0;
}

.card-name {
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-remarks {
  font-size: 11px;
  color: #8b949e;
  margin-top: 4px;
}

.card-url {
  font-size: 10px;
  color: #484f58;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-group {
  margin-bottom: 12px;
}

.group-title {
  font-size: 14px;
  font-weight: 500;
  color: #8b949e;
  margin-bottom: 8px;
}

.track-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.track-btn {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: #c9d1d9;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.track-btn:hover {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
}

.track-btn.active {
  border-color: #58a6ff;
  background: rgba(88, 166, 255, 0.15);
  color: #58a6ff;
}

.result-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-item {
  display: flex;
  gap: 8px;
}

.result-label {
  min-width: 70px;
  color: #8b949e;
  font-size: 13px;
}

.result-value {
  color: #c9d1d9;
  font-size: 13px;
  word-break: break-all;
}

.result-value.error { color: #f85149; }

.success { color: #3fb950; }
.error { color: #f85149; }

.test-player {
  background: rgba(22, 27, 34, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}

.player-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #fff;
}

.test-video {
  width: 100%;
  border-radius: 8px;
  background: #000;
}

.raw-json {
  font-size: 11px;
  color: #8b949e;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
  background: rgba(0,0,0,0.3);
  padding: 12px;
  border-radius: 6px;
}
</style>
