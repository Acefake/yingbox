<template>
  <div
    class="online-view h-full min-h-0 bg-yb-bg text-yb-text"
    :class="{ 'is-bleed': !inlineDetailItem && activeTab === 'home' }"
  >
    <!-- 首页：Hero 铺到浮动侧栏和顶栏胶囊下面，下面几排按 --home-x 让开侧栏 -->
    <div
      v-show="!inlineDetailItem && activeTab === 'home'"
      class="content-area primary-scroll home-page"
      :class="{ 'has-hero': hero.slides.value.length || hero.loading.value }"
    >
      <HomeHero
        :slides="hero.slides.value"
        :loading="hero.loading.value"
        :active="activeTab === 'home' && !inlineDetailItem"
      />
      <div class="home-rows">
        <ContinueRow
          :section="HOME_CONTINUE"
          more-label="打开最近播放"
          @more="router.push({ path: '/', query: { tab: 'recent' } })"
          @detail="openContinueDetail"
        />
        <RecentlyAddedRow />
        <WatchlistRow
          section="online"
          @open="
            e => e.detail && openDetailWindow(e.detail as OnlineDetailItem)
          "
        />
        <DoubanSection @open="openDoubanDetail" />
      </div>
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
import { useRoute, useRouter } from 'vue-router'
import DoubanSection from '../components/DoubanSection.vue'
import HomeHero from '../components/HomeHero.vue'
import SearchTab from '../components/SearchTab.vue'
import VodBrowse from '../components/VodBrowse.vue'
import DetailWindow from '../components/DetailWindow.vue'
import LibraryCollection from '../components/LibraryCollection.vue'
import { pendingOnlineDetail, takeOnlineDetail } from '../utils/detail-request'
import { RecentlyAddedRow, libraryItemLocation } from '@/features/library'
import {
  type ContinueRecord,
  ContinueRow,
  type ContinueSection,
  getMediaProgress,
  openMediaPlayer,
} from '@/features/player'
import { WatchlistRow } from '@/features/watchlist'
import { useHomeHero } from '../composables/use-home-hero'
import { doubanDetail } from '../utils/douban-detail'

const route = useRoute()
const router = useRouter()
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
// 别的页面（追剧日历）请求打开的详情：跳到本页后取走
watch(
  pendingOnlineDetail(),
  item => {
    if (item) openDetailWindow(takeOnlineDetail() as OnlineDetailItem)
  },
  { immediate: true }
)
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
    toast.error('无法打开播放器，已改为进入详情')
    if (item?.vod_name) openDetailWindow(item)
  }
}

const openDoubanDetail = (item: DoubanItem): void => {
  inlineDetailItem.value = doubanDetail(item)
}

// ─── 首页 ───────────────────────────────────────────────
const hero = useHomeHero(openDoubanDetail)
/** 首页的「继续观看」合并在线与片库电影、剧集 */
const HOME_CONTINUE: ContinueSection[] = ['online', 'movie', 'tv']
/** 继续观看的「打开详情」：在线条目在本页打开，片库条目去片库页（?item=） */
const openContinueDetail = (record: ContinueRecord): void => {
  if (record.section === 'online') {
    if (record.detail) openDetailWindow(record.detail as OnlineDetailItem)
    return
  }
  const itemId = (record.detail as { itemId?: number } | undefined)?.itemId
  if (typeof itemId === 'number')
    void router.push(
      libraryItemLocation(record.section === 'tv' ? 'series' : 'movie', itemId)
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

/*
 * 首页铺满窗口：整页往左上让回外壳留出的 --shell-left / --shell-top，Hero 从窗口左上角开始，
 * 浮动侧栏和顶栏胶囊压在它上面（这里不建层叠上下文，侧栏、胶囊的 z-index 才比得过）。
 * Hero 文案和下面几排的左边距 --home-x = 侧栏让出的宽度 + 28px。
 */
.online-view.is-bleed {
  --home-x: calc(var(--shell-left) + var(--space-6_5));
  z-index: auto;
  height: calc(100% + var(--shell-top));
  margin: calc(var(--shell-top) * -1) 0 0 calc(var(--shell-left) * -1);
}
.home-page:where(.has-hero) {
  padding: 0 0 var(--space-11);
  gap: 0;
}
.home-page:where(.has-hero) .home-rows {
  padding: var(--space-8) var(--space-8) 0 var(--home-x);
}
.home-page:where(:not(.has-hero)) {
  padding: var(--shell-top) var(--space-8) var(--space-8) var(--home-x);
}
.home-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  min-width: 0;
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
  .online-view.is-bleed {
    --home-x: calc(var(--shell-left) + var(--space-5));
  }
  .home-page:where(.has-hero) .home-rows {
    padding: var(--space-6) var(--space-5) 0 var(--home-x);
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
