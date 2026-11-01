<template>
  <div class="nas-home" :class="{ 'is-bleed': !browse.target.value }">
    <div
      v-if="!browse.target.value"
      class="home-page primary-scroll"
      :class="{ 'has-hero': hero.slides.value.length || hero.loading.value }"
    >
      <HomeHero
        :slides="hero.slides.value"
        :loading="hero.loading.value"
        :active="active"
      />
      <div class="home-rows" data-shelf-wheel="page">
        <GenreRow
          @open="genre => browse.open({ type: 'genre', genre, kind: 'movie' })"
          @collections="scrollCollections"
        />
        <ContinueRow
          :section="['movie', 'tv']"
          :resume="resumeLibrary"
          @detail="openContinue"
        />
        <HomeSetupBar />
        <HomeActivity @open="openWatchlist" />
        <DoubanChartRow @open="openDouban" />
        <HotShelf
          kind="movie"
          @open="openDouban"
          @more="kind => browse.open({ type: 'hot', kind })"
        />
        <HotShelf
          kind="tv"
          @open="openDouban"
          @more="kind => browse.open({ type: 'hot', kind })"
        />
        <CollectionRow @open="list => browse.open({ type: 'list', list })" />
      </div>
    </div>
    <div v-else class="home-browse primary-scroll">
      <DoubanBrowse
        :target="browse.target.value"
        @open="openDouban"
        @kind="browse.setKind"
        @back="browse.close"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/** NAS 复用原首页的轮播、类型、动态、豆瓣榜单、热门和片单。 */
import { computed, onActivated, onDeactivated, ref } from 'vue'
import { useRouter } from 'vue-router'
import { type ContinueRecord, ContinueRow } from '@/features/player'
import { libraryItemLocation, resumeLibrary } from '@/features/library'
import { openDiscoverDialog } from '@/features/discover'
import HomeHero from '@/features/online/components/HomeHero.vue'
import GenreRow from '@/features/online/components/GenreRow.vue'
import HomeSetupBar from '@/features/online/components/HomeSetupBar.vue'
import DoubanChartRow from '@/features/online/components/DoubanChartRow.vue'
import HotShelf from '@/features/online/components/HotShelf.vue'
import CollectionRow from '@/features/online/components/CollectionRow.vue'
import DoubanBrowse from '@/features/online/components/DoubanBrowse.vue'
import { useHomeHero } from '@/features/online/composables/use-home-hero'
import { useBrowseRoute } from '@/features/online/composables/use-browse-route'
import type { DoubanItem } from '@/features/online/types'
import { openDoubanDiscover } from '@/features/online/utils/douban-discover'
import { doubanSubjectId } from '@/features/online/utils/douban-preview'
import { toast } from '@/components/ui/toast'
import HomeActivity from '../home/ActivityRow.vue'
import '../home/home.css'

const router = useRouter()
const active = ref(true)
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
})
const browse = useBrowseRoute(computed(() => true))
const originalHero = useHomeHero(openDouban, openContinue)
const hero = {
  ...originalHero,
  slides: computed(() =>
    originalHero.slides.value.map(slide =>
      slide.key.startsWith('douban:')
        ? { ...slide, playLabel: '网盘搜索' }
        : slide
    )
  ),
}

function openDouban(item: DoubanItem): void {
  if (item.kind === 'tv') {
    void router.push({ path: '/netdisk', query: { q: item.title } })
    return
  }
  void openDoubanDiscover(item)
}

function openWatchlist(detail: unknown): void {
  if (!detail || typeof detail !== 'object') return
  const item = detail as {
    doubanUrl?: string
    url?: string
    vod_name?: string
    vod_pic?: string
    doubanKind?: 'movie' | 'tv'
  }
  const url = item.doubanUrl ?? item.url ?? ''
  if (item.doubanKind === 'tv') {
    void router.push({ path: '/netdisk', query: { q: item.vod_name ?? '' } })
    return
  }
  const id = doubanSubjectId(url)
  if (!id) {
    toast.info('请在片库或网盘中查找这部影片')
    return
  }
  void openDiscoverDialog({
    doubanId: id,
    kind: item.doubanKind ?? 'movie',
    title: item.vod_name ?? '',
    originalTitle: '',
    year: null,
    rate: '',
    cover: item.vod_pic ?? '',
    tmdbId: null,
  })
}

function openContinue(record: ContinueRecord): void {
  const detail = record.detail as { itemId?: number } | undefined
  if (detail?.itemId)
    void router.push(
      libraryItemLocation(
        record.section === 'tv' ? 'series' : 'movie',
        detail.itemId
      )
    )
}

function scrollCollections(): void {
  document
    .getElementById('home-collections')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>
