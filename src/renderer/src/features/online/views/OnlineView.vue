<template>
  <div
    class="online-view h-full min-h-0 bg-yb-bg text-yb-text"
    :class="{
      'is-bleed': !inlineDetailItem && activeTab === 'home' && !browseTarget,
    }"
  >
    <!-- 首页：Hero 铺到浮动侧栏和顶栏胶囊下面，下面几排按 --home-x 让开侧栏 -->
    <div
      v-show="!inlineDetailItem && activeTab === 'home' && !browseTarget"
      class="content-area primary-scroll home-page"
      :class="{ 'has-hero': hero.slides.value.length || hero.loading.value }"
    >
      <HomeHero
        :slides="hero.slides.value"
        :loading="hero.loading.value"
        :active="activeTab === 'home' && !inlineDetailItem"
      />
      <div class="home-rows">
        <GenreRow
          @open="genre => browse.open({ type: 'genre', genre, kind: 'movie' })"
          @collections="scrollCollections"
        />
        <ContinueRow
          :section="HOME_SECTIONS"
          :resume="resumeContinue"
          more-label="打开最近播放"
          @more="router.push({ path: '/', query: { tab: 'recent' } })"
          @detail="openContinueDetail"
        />
        <HomeSetupBar />
        <HomeActivityRow
          @open="detail => openDetailWindow(detail as OnlineDetailItem)"
        />
        <DoubanChartRow @open="openDoubanDetail" />
        <HotShelf
          @open="openDoubanDetail"
          @more="kind => browse.open({ type: 'hot', kind })"
        />
        <CollectionRow @open="list => browse.open({ type: 'list', list })" />
      </div>
    </div>

    <!-- 首页的浏览页（热门全部 / 类型 / 片单），挂在首页路由的 ?browse= 上 -->
    <div
      v-if="browseTarget"
      v-show="!inlineDetailItem && activeTab === 'home'"
      class="content-area primary-scroll home-content-area"
    >
      <DoubanBrowse
        :target="browseTarget"
        @open="openDoubanDetail"
        @kind="browse.setKind"
        @back="browse.close"
      />
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
        <div class="inline-detail-edge" aria-hidden="true" />
        <div class="inline-detail-toolbar">
          <UiButton
            class="inline-detail-back yb-on-media"
            label="返回"
            icon="back"
            variant="glass"
            @click="detailRoute.close()"
          />
        </div>
        <DetailWindow :item="inlineDetailItem" />
      </section>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { UiButton, toast } from '@/components/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  CmsItem,
  DoubanItem,
  OnlineDetailItem,
  OnlinePlayRecord,
} from '../types'
import { useRoute, useRouter } from 'vue-router'
import DoubanChartRow from '../components/DoubanChartRow.vue'
import CollectionRow from '../components/CollectionRow.vue'
import DoubanBrowse from '../components/DoubanBrowse.vue'
import GenreRow from '../components/GenreRow.vue'
import HomeActivityRow from '../components/HomeActivityRow.vue'
import HomeSetupBar from '../components/HomeSetupBar.vue'
import HotShelf from '../components/HotShelf.vue'
import HomeHero from '../components/HomeHero.vue'
import SearchTab from '../components/SearchTab.vue'
import VodBrowse from '../components/VodBrowse.vue'
import DetailWindow from '../components/DetailWindow.vue'
import LibraryCollection from '../components/LibraryCollection.vue'
import { pendingOnlineDetail, takeOnlineDetail } from '../utils/detail-request'
import { libraryItemLocation, resumeLibrary } from '@/features/library'
import {
  type ContinueRecord,
  ContinueRow,
  getMediaProgress,
  metaOf,
  openMediaPlayer,
  replayOptions,
} from '@/features/player'
import { useBrowseRoute } from '../composables/use-browse-route'
import { useOnlineDetailRoute } from '../composables/use-online-detail-route'
import { useHomeHero } from '../composables/use-home-hero'
import { HOME_SECTIONS } from '../utils/hero-rules'
import { doubanDetail } from '../utils/douban-detail'

const route = useRoute()
const router = useRouter()
const resumeContinue = (
  record: ContinueRecord,
  fromStart: boolean
): Promise<boolean> =>
  record.section === 'movie' || record.section === 'tv'
    ? resumeLibrary(record, fromStart)
    : openMediaPlayer({
        ...replayOptions(record),
        ...(fromStart ? { startAt: 0 } : {}),
        continueAs: metaOf(record),
      })
const detailRoute = useOnlineDetailRoute(router)
const inlineDetailItem = detailRoute.item

const handleNavigateBack = (event: Event): void => {
  if (!inlineDetailItem.value) return
  detailRoute.close()
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
  }
)
// ─── 详情 / 搜索 ───────────────────────────────────────────
const openDetailWindow = (item: CmsItem | OnlineDetailItem): void => {
  void detailRoute.open(item)
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
  void detailRoute.open(doubanDetail(item))
}

// ─── 首页 ───────────────────────────────────────────────
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
const hero = useHomeHero(openDoubanDetail, openContinueDetail)

function scrollCollections(): void {
  document.getElementById('home-collections')?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}

// 浏览页（热门全部 / 类型 / 片单）与详情共用路由历史。
const browse = useBrowseRoute(computed(() => activeTab.value === 'home'))
const browseTarget = browse.target
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
/* 第一排（快速浏览）压进 Hero 底部 --home-hero-overlap，Hero 加高同样多（home-hero.css） */
.home-page:where(.has-hero) {
  --home-hero-overlap: var(--space-10);
  padding: 0 0 var(--space-11);
  gap: 0;
}
.home-page:where(.has-hero) .home-rows {
  position: relative;
  margin-top: calc(var(--home-hero-overlap) * -1);
  padding: 0 var(--space-8) 0 var(--home-x);
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
  --detail-x: calc(var(--shell-left, 0px) + var(--space-6_5));
  --detail-gutter: var(--space-8);
  display: flex;
  flex-direction: column;
  position: fixed;
  inset: 0;
  z-index: var(--z-float);
  width: 100%;
  background: var(--bg-content);
}

.inline-detail-toolbar {
  position: absolute;
  top: var(--shell-pill-top);
  left: var(--detail-x);
  z-index: var(--z-float);
  -webkit-app-region: no-drag;
}

.inline-detail-edge {
  position: absolute;
  inset: 0 0 auto;
  height: 104px;
  z-index: var(--z-float);
  background: linear-gradient(
    color-mix(in srgb, var(--bg-content) 62%, transparent),
    transparent
  );
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  mask: var(--mask-fade-end-30);
  -webkit-mask: var(--mask-fade-end-30);
  pointer-events: none;
}

.inline-detail-back {
  height: var(--shell-pill-height);
  border-radius: var(--radius-full);
}

.inline-detail-page :deep(.detail-win) {
  flex: 1;
  min-height: 0;
  width: 100%;
  height: auto;
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
    padding: 0 var(--space-5) 0 var(--home-x);
  }
}

@media (max-width: 768px),
  (max-width: 1024px) and (pointer: coarse) and (max-height: 600px) {
  .inline-detail-page {
    --detail-x: var(--space-4);
    --detail-gutter: var(--space-4);
  }
  .inline-detail-toolbar {
    top: calc(var(--safe-top) + var(--space-2));
  }
  .inline-detail-page :deep(.dw-content) {
    padding-top: calc(
      var(--safe-top) + var(--shell-pill-height) + var(--space-6)
    );
    padding-bottom: calc(var(--space-6) + var(--safe-bottom));
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
