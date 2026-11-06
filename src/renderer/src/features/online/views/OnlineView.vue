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
      <div class="home-rows" data-shelf-wheel="page">
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
          kind="movie"
          @open="openDoubanDetail"
          @more="kind => browse.open({ type: 'hot', kind })"
        />
        <HotShelf
          kind="tv"
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
      class="content-area primary-scroll home-content-area has-atmosphere"
    >
      <LibraryCollection kind="favorites" @open="openDetailWindow" />
    </div>
    <div
      v-show="!inlineDetailItem && activeTab === 'recent'"
      class="content-area primary-scroll home-content-area has-atmosphere"
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
import { HOME_SECTIONS } from '../../../../../shared/playback/hero-rules'
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
const hero = useHomeHero(openDoubanDetail)

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

<style scoped src="./online-view.css"></style>
