<template>
  <div class="online-view h-full min-h-0 bg-yb-bg text-yb-text">
    <!-- 首页 -->
    <div
      v-show="!inlineDetailItem && activeTab === 'home'"
      class="content-area primary-scroll home-content-area"
    >
      <DoubanSection @open="openDoubanDetail" />
    </div>

    <!-- VOD 浏览 -->
    <div
      v-show="!inlineDetailItem && activeTab === 'vod'"
      class="content-area primary-scroll"
    >
      <VodBrowse @open-item="openDetailWindow" />
    </div>

    <!-- 搜索 -->
    <SearchTab
      v-show="!inlineDetailItem && activeTab === 'search'"
      @open-item="openDetailWindow"
    />

    <div
      v-show="!inlineDetailItem && activeTab === 'favorites'"
      class="content-area primary-scroll home-content-area"
    >
      <LibraryCollection kind="favorites" @open="openDetailWindow" />
    </div>
    <div
      v-show="!inlineDetailItem && activeTab === 'recent'"
      class="content-area primary-scroll home-content-area"
    >
      <LibraryCollection
        kind="recent"
        @open="openDetailWindow"
        @resume="resumeRecentPlay"
      />
    </div>

    <Transition name="detail-page">
      <section
        v-if="inlineDetailItem"
        class="inline-detail-page"
        aria-label="内容详情"
      >
        <DetailWindow :item="inlineDetailItem" />
      </section>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { toast } from '@/components/ui'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  CmsItem,
  DoubanItem,
  OnlineDetailItem,
  OnlinePlayRecord,
} from '../types'
import { useRoute } from 'vue-router'
import DoubanSection from '../components/DoubanSection.vue'
import SearchTab from '../components/SearchTab.vue'
import VodBrowse from '../components/VodBrowse.vue'
import DetailWindow from '../components/DetailWindow.vue'
import LibraryCollection from '../components/LibraryCollection.vue'
import { getMediaProgress, openMediaPlayer } from '@/features/player'

const route = useRoute()
const inlineDetailItem = ref<OnlineDetailItem | null>(null)
const handleNavigateBack = (event: Event): void => {
  if (!inlineDetailItem.value) return
  inlineDetailItem.value = null
  event.preventDefault()
}
onMounted(() =>
  window.addEventListener('app:navigate-back', handleNavigateBack)
)
onBeforeUnmount(() =>
  window.removeEventListener('app:navigate-back', handleNavigateBack)
)

// ─── Tab ───────────────────────────────────────────────
type OnlineTab = 'home' | 'vod' | 'search' | 'favorites' | 'recent'
const isOnlineTab = (value: unknown): value is OnlineTab =>
  value === 'home' ||
  value === 'vod' ||
  value === 'search' ||
  value === 'favorites' ||
  value === 'recent'
const activeTab = ref<OnlineTab>(
  isOnlineTab(route.query.tab) ? route.query.tab : 'home'
)
watch(
  () => route.query.tab,
  tab => {
    activeTab.value = isOnlineTab(tab) ? tab : 'home'
    // 详情是当前在线页内的覆盖层。切换首页、最近播放、收藏或 VOD 标签时，
    // 必须先关闭覆盖层，否则底层内容已切换但仍被详情层遮住。
    inlineDetailItem.value = null
  }
)
// ─── 详情 / 搜索 ───────────────────────────────────────────
const openDetailWindow = (item: CmsItem | OnlineDetailItem): void => {
  inlineDetailItem.value = JSON.parse(JSON.stringify(item))
}
const resumeRecentPlay = async (record: OnlinePlayRecord): Promise<void> => {
  const url = typeof record?.url === 'string' ? record.url.trim() : ''
  // 旧记录没有 item，条目字段平铺在记录上
  const item = (record?.item || record) as OnlineDetailItem
  if (!url) {
    if (item?.vod_name) openDetailWindow(item)
    return
  }
  const name = item?.vod_name || record?.vod_name || ''
  const epName = typeof record?.epName === 'string' ? record.epName : ''
  const title = [name, epName].filter(Boolean).join(' · ') || '继续播放'
  const poster =
    (typeof item?.vod_pic === 'string' && item.vod_pic) ||
    (typeof record?.vod_pic === 'string' && record.vod_pic) ||
    undefined
  const stored =
    typeof record?.progress === 'number' && record.progress > 0
      ? record.progress
      : getMediaProgress(url)
  const ok = await openMediaPlayer({ url, title, poster, startAt: stored })
  if (!ok) {
    toast.error('无法打开播放窗口，已改为进入详情')
    if (item?.vod_name) openDetailWindow(item)
  }
}

const openDoubanDetail = (item: DoubanItem): void => {
  inlineDetailItem.value = JSON.parse(
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
}
</script>

<style scoped>
.online-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  color: var(--text-main);
  overflow: hidden;
  -webkit-app-region: no-drag;
  position: relative;
  z-index: var(--z-float);
}

.content-area {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6) var(--space-7);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.home-content-area {
  padding: var(--space-7) var(--space-8) var(--space-8);
  gap: var(--space-7);
}

.inline-detail-page {
  position: absolute;
  inset: 0;
  z-index: var(--z-overlay);
  width: 100%;
  background: var(--bg-main);
}

.inline-detail-page :deep(.detail-win) {
  width: 100%;
  height: 100%;
}

.detail-page-enter-active,
.detail-page-leave-active {
  transition: opacity var(--duration-normal) ease;
}
.detail-page-enter-from,
.detail-page-leave-to {
  opacity: 0;
}

@media (max-width: 860px) {
  .home-content-area {
    padding: var(--space-4) var(--space-5) var(--space-6);
  }
}

.content-area::-webkit-scrollbar {
  width: 4px;
}

.content-area::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: var(--radius-xs);
}
</style>
