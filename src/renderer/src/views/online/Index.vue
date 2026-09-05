<template>
  <div class="online-view">
    <!-- 首页 -->
    <div v-show="!inlineDetailItem && activeTab === 'home'" class="content-area primary-scroll home-content-area">
      <DoubanSection @open="openDoubanDetail" />
    </div>

    <!-- VOD 浏览 -->
    <div v-show="!inlineDetailItem && activeTab === 'vod'" class="content-area primary-scroll">
      <VodBrowse @open-item="openDetailWindow" />
    </div>

    <!-- 搜索 -->
    <SearchTab v-show="!inlineDetailItem && activeTab === 'search'" @open-item="openDetailWindow" />

    <div v-show="!inlineDetailItem && activeTab === 'favorites'" class="content-area primary-scroll home-content-area">
      <LibraryCollection kind="favorites" @open="openDetailWindow" />
    </div>
    <div v-show="!inlineDetailItem && activeTab === 'recent'" class="content-area primary-scroll home-content-area">
      <LibraryCollection kind="recent" @open="openDetailWindow" />
    </div>

    <Transition name="detail-page">
      <section v-if="inlineDetailItem" class="inline-detail-page" aria-label="内容详情">
        <DetailWindow :item="inlineDetailItem" />
      </section>
    </Transition>

  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { type CmsItem } from './composables/use-online-search'
import { useRoute } from 'vue-router'
import DoubanSection, { type DoubanItem } from './components/DoubanSection.vue'
import SearchTab from './components/SearchTab.vue'
import VodBrowse from './components/VodBrowse.vue'
import DetailWindow from './DetailWindow.vue'
import LibraryCollection from './components/LibraryCollection.vue'

const route = useRoute()
const inlineDetailItem = ref<CmsItem | null>(null)
const handleNavigateBack = (event: Event) => {
  if (!inlineDetailItem.value) return
  inlineDetailItem.value = null
  event.preventDefault()
}
onMounted(() => window.addEventListener('app:navigate-back', handleNavigateBack))
onBeforeUnmount(() => window.removeEventListener('app:navigate-back', handleNavigateBack))

// ─── Tab ───────────────────────────────────────────────
type OnlineTab = 'home' | 'vod' | 'search' | 'favorites' | 'recent'
const isOnlineTab = (value: unknown): value is OnlineTab =>
  value === 'home' || value === 'vod' || value === 'search' || value === 'favorites' || value === 'recent'
const activeTab = ref<OnlineTab>(isOnlineTab(route.query.tab) ? route.query.tab : 'home')
watch(
  () => route.query.tab,
  (tab) => {
    activeTab.value = isOnlineTab(tab) ? tab : 'home'
    // 详情是当前在线页内的覆盖层。切换首页、最近播放、收藏或 VOD 标签时，
    // 必须先关闭覆盖层，否则底层内容已切换但仍被详情层遮住。
    inlineDetailItem.value = null
  }
)
// ─── 详情 / 搜索 ───────────────────────────────────────────
const openDetailWindow = (item: CmsItem) => {
  inlineDetailItem.value = JSON.parse(JSON.stringify(item))
}

const openDoubanDetail = (item: DoubanItem) => {
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
  color: white;
  overflow: hidden;
  -webkit-app-region: no-drag;
  position: relative;
  z-index: 10;
}

.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.home-content-area { padding: 22px 40px 34px; gap: 28px; }

.inline-detail-page {
  position: absolute;
  inset: 0;
  z-index: 40;
  width: 100%;
  background: #15181d;
}

.inline-detail-page :deep(.detail-win) {
  width: 100%;
  height: 100%;
}

.detail-page-enter-active,
.detail-page-leave-active { transition: opacity 0.2s ease; }
.detail-page-enter-from,
.detail-page-leave-to { opacity: 0; }

@media (max-width: 860px) {
  .home-content-area { padding: 18px 20px 24px; }
}

.content-area::-webkit-scrollbar {
  width: 4px;
}

.content-area::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}
</style>
