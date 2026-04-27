<template>
  <div class="online-view">
    <div class="tab-nav">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id as 'home' | 'search' | 'ext'"
      >
        {{ tab.label }}
      </button>
      <button class="debug-btn" @click="openVODTest">调试</button>
    </div>

    <!-- 首页 -->
    <div v-show="activeTab === 'home'" class="content-area">
      <PlayHistory
        :history="playHistory"
        @clear="clearPlayHistory"
        @open="openPlayRecord"
      />
      <DoubanSection @open="openDoubanDetail" />
    </div>

    <!-- 搜索 -->
    <SearchTab v-show="activeTab === 'search'" @open-item="openDetailWindow" />

    <!-- 扩展 -->
    <ExtTab v-show="activeTab === 'ext'" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { type CmsItem } from './composables/use-online-search'
import { useRouter } from 'vue-router'
import PlayHistory, { type PlayRecord } from './components/PlayHistory.vue'
import DoubanSection, { type DoubanItem } from './components/DoubanSection.vue'
import SearchTab from './components/SearchTab.vue'
import ExtTab from './components/ExtTab.vue'

const router = useRouter()

// ─── 播放记录 ────────────────────────────────────────────
const PLAY_HISTORY_KEY = 'online_play_history'
const playHistory = ref<PlayRecord[]>(
  JSON.parse(localStorage.getItem(PLAY_HISTORY_KEY) || '[]')
)

const clearPlayHistory = () => {
  playHistory.value = []
  localStorage.removeItem(PLAY_HISTORY_KEY)
}

// ─── Tab ───────────────────────────────────────────────
const tabs = [
  { id: 'home', label: '首页' },
  { id: 'search', label: '搜索' },
  { id: 'ext', label: '扩展' },
]
const activeTab = ref<'home' | 'search' | 'ext'>('home')
// ─── 详情 / 搜索 ───────────────────────────────────────────
const openDetailWindow = (item: CmsItem) => {
  ;(window.api as any).detail.open(JSON.parse(JSON.stringify(item)))
}

const openDoubanDetail = (item: DoubanItem) => {
  ;(window.api as any).detail.open(
    JSON.parse(
      JSON.stringify({
        _source: 'douban',
        vod_name: item.title,
        vod_pic: item.cover,
        type_name: item.type,
        vod_year: item.year,
        overview: item.overview,
        searchTitle: item.searchTitle,
      })
    )
  )
}

const openPlayRecord = (record: PlayRecord) => openDetailWindow(record.item)

const openVODTest = () => {
  router.push('/vod-test')
}
</script>

<style scoped>
.online-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  color: white;
  overflow: hidden;
  -webkit-app-region: no-drag;
  position: relative;
  z-index: 10;
}

.tab-nav {
  display: flex;
  gap: 4px;
  padding: 24px 24px 0;
  flex-shrink: 0;
}

.tab-btn {
  padding: 8px 20px;
  border-radius: 8px 8px 0 0;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn.active {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-weight: 600;
}

.tab-btn:hover:not(.active) {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.85);
}

.debug-btn {
  margin-left: auto;
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 152, 0, 0.15);
  color: #ff9800;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.debug-btn:hover {
  background: rgba(255, 152, 0, 0.25);
  border-color: rgba(255, 152, 0, 0.4);
}

.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.content-area::-webkit-scrollbar {
  width: 4px;
}
.content-area::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}
</style>
