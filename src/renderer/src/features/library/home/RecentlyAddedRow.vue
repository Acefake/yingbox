<template>
  <UiShelf
    v-if="items.length"
    class="recent-row"
    title="最近添加"
    kind="portrait"
    more
    :more-label="moreTarget === '/tv' ? '打开剧集库' : '打开电影库'"
    @more="router.push(moreTarget)"
  >
    <UiPosterCard
      v-for="item in items"
      :key="item.id"
      thumb
      :title="item.title"
      :cover="item.poster ?? undefined"
      :subtitle="subtitleOf(item)"
      @open="router.push(libraryItemLocation(item.type, item.id))"
    />
  </UiShelf>
</template>

<script setup lang="ts">
/**
 * 首页的「最近添加」一排：本地片库最近入库的竖版海报（TMDB 来源，新的在前），点海报打开片库详情，
 * 标题的 › 打开电影库或剧集库（这一排里哪种多去哪个）。没有片库或片库为空时整块不渲染；
 * 挂载和每次回到首页时重取。
 */
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiShelf from '@/components/ui/UiShelf.vue'

import {
  type RecentLibraryItem,
  libraryItemLocation,
  recentLibraryItems,
} from './home-links'

const router = useRouter()
const items = ref<RecentLibraryItem[]>([])

async function reload(): Promise<void> {
  items.value = await recentLibraryItems(20).catch(() => [])
}

onMounted(() => void reload())
onActivated(() => void reload())

const moreTarget = computed(() => {
  const series = items.value.filter(item => item.type === 'series').length
  return series > items.value.length / 2 ? '/tv' : '/movie'
})

function subtitleOf(item: RecentLibraryItem): string {
  return [item.year, item.type === 'series' ? '剧集' : '电影']
    .filter(Boolean)
    .join(' · ')
}
</script>
