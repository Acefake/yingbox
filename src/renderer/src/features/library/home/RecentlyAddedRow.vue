<template>
  <UiShelf
    v-if="items.length"
    class="recent-row"
    title="刚入库"
    more
    :more-label="moreTarget === '/tv' ? '打开剧集库' : '打开电影库'"
    list
    @more="router.push(moreTarget)"
  >
    <template v-if="weekCount" #actions>
      <span class="recent-row-count">近 7 天新增 {{ weekCount }} 部</span>
    </template>
    <UiEpisodeCard
      v-for="item in items"
      :key="item.id"
      role="listitem"
      :title="item.title"
      :subtitle="subtitleOf(item)"
      :image="item.backdrop ?? item.poster ?? undefined"
      :label="`打开 ${item.title}`"
      @open="router.push(libraryItemLocation(item.type, item.id))"
    >
      <template v-if="item.quality" #badge>
        <UiSpecBadge class="recent-row-badge" v-bind="item.quality" />
      </template>
    </UiEpisodeCard>
  </UiShelf>
</template>

<script setup lang="ts">
/**
 * 首页的「刚入库」一排：本地片库最近入库的横版背景图卡（TMDB 来源，新的在前，最多 12 张），
 * 卡上是片名、「今天 · 电影」这类入库时间，右上角画质角标（认得出时）；点卡打开片库详情，
 * 标题的 › 打开电影库或剧集库（这一排里哪种多去哪个）。没有片库或片库为空时整块不渲染；
 * 挂载和每次回到首页时重取。入库来源（115 转存 / 磁力离线）片库没有记录，不显示。
 */
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import UiEpisodeCard from '@/components/ui/UiEpisodeCard.vue'
import UiShelf from '@/components/ui/UiShelf.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'

import {
  type RecentLibraryItem,
  libraryItemLocation,
  recentLibraryItems,
} from './home-links'
import { addedLabel } from './recent-rules'

/** 一排最多几张 */
const LIMIT = 12

const router = useRouter()
const items = ref<RecentLibraryItem[]>([])
/** 入库时间文案的基准时间：每次重取时刷新 */
const now = ref(Date.now())

async function reload(): Promise<void> {
  items.value = await recentLibraryItems(LIMIT).catch(() => [])
  now.value = Date.now()
}

onMounted(() => void reload())
onActivated(() => void reload())

const moreTarget = computed(() => {
  const series = items.value.filter(item => item.type === 'series').length
  return series > items.value.length / 2 ? '/tv' : '/movie'
})

/** 7 天内入库的部数；这一排全是 7 天内的（后面可能还有）时写「12+」 */
const weekCount = computed(() => {
  const count = items.value.filter(
    item => now.value - item.addedAt < 7 * 86_400_000
  ).length
  return count >= LIMIT ? `${LIMIT}+` : count
})

function subtitleOf(item: RecentLibraryItem): string {
  return [
    addedLabel(item.addedAt, now.value),
    item.type === 'series' ? '剧集' : '电影',
  ].join(' · ')
}
</script>

<style scoped>
.recent-row-count {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.recent-row-badge {
  --spec-bg: var(--spec-media-bg);
  --spec-text: var(--spec-media-text);
  --spec-line: var(--spec-media-line);
}
</style>
