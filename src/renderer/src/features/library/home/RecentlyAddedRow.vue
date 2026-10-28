<template>
  <template v-if="pane">
    <UiEpisodeCard
      v-for="item in paneItems"
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
  </template>
  <UiShelf
    v-else-if="items.length"
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
 * 「刚入库」横卡：本地片库最近入库的横版背景图（TMDB 来源，新的在前，最多 12 张），
 * 卡上是片名、「今天 · 电影」这类入库时间，右上角画质角标（认得出时）；点卡打开片库详情。
 * 单独使用时自带货架，标题的 › 打开电影库或剧集库（这一排里哪种多去哪个）。
 * pane 时只输出卡片，交给首页「我的动态」：active 为假时不画卡，数量仍通过 count 报出。
 * 没有片库或片库为空时没有卡；挂载和每次回到首页时重取。
 * 入库来源（115 转存 / 磁力离线）片库没有记录，不显示。
 */
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import UiEpisodeCard from '@/components/ui/UiEpisodeCard.vue'
import UiShelf from '@/components/ui/UiShelf.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'

import {
  type RecentLibraryItem,
  libraryItemLocation,
  recentLibraryItems,
  recentQualities,
} from './home-links'
import { addedLabel } from './recent-rules'

/** 一排最多几张 */
const LIMIT = 12

const props = withDefaults(
  defineProps<{
    /** 只输出卡片，不包货架（首页「我的动态」） */
    pane?: boolean
    /** pane 时是否画出卡片；为假仍统计数量 */
    active?: boolean
  }>(),
  { active: true }
)
const emit = defineEmits<{ count: [n: number] }>()

const router = useRouter()
const items = ref<RecentLibraryItem[]>([])
/** 入库时间文案的基准时间：每次重取时刷新 */
const now = ref(Date.now())

/** 先按列表出卡，再逐条补画质角标（详情慢或失败都不挡这一排） */
let generation = 0

async function reload(): Promise<void> {
  const run = ++generation
  const list = await recentLibraryItems(LIMIT).catch(() => [])
  if (run !== generation) return
  items.value = list
  now.value = Date.now()
  const badges = await recentQualities(list).catch(() => null)
  if (!badges || run !== generation) return
  items.value = list.map((item, i) => ({ ...item, quality: badges[i] }))
}

const paneItems = computed(() =>
  props.pane && props.active ? items.value : []
)

onMounted(() => void reload())
onActivated(() => void reload())
watch(
  () => items.value.length,
  n => emit('count', n),
  { immediate: true }
)

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
