<template>
  <div class="library-collection">
    <PageHeader :title="title" :description="description">
      <template #actions
        ><UiIconButton
          v-if="items.length"
          icon="trash"
          label="清空记录"
          danger
          @click="clear"
      /></template>
    </PageHeader>
    <UiSegmented
      v-model="category"
      class="collection-tabs"
      label="媒体类型"
      :options="tabs"
    />
    <UiVirtualGrid
      v-if="filteredItems.length"
      :items="filteredItems"
      class="ui-poster-grid"
      :item-key="entry => entry.id"
    >
      <template #default="{ item: entry }">
        <UiPosterCard
          thumb
          :title="entry.item.vod_name ?? ''"
          :cover="entry.item.vod_pic"
          :subtitle="
            [entry.typeLabel, entry.epName || entry.item.vod_year]
              .filter(Boolean)
              .join(' · ')
          "
          @open="onOpen(entry)"
        />
      </template>
    </UiVirtualGrid>
    <StatusState
      v-else
      class="collection-empty"
      :icon="empty.icon"
      :title="empty.title"
      :hint="empty.hint"
    />
  </div>
</template>

<script setup lang="ts">
import StatusState from '@/components/StatusState.vue'
import { confirmDialog } from '@/components/ui'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import PageHeader from '@/components/PageHeader.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSegmented, {
  type SegmentedOption,
} from '@/components/ui/UiSegmented.vue'
import { asRecord, asText } from '@/utils/json'
import { readStoredArray } from '@/utils/storage'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { OnlineDetailItem, OnlinePlayRecord } from '../types'

/** 收藏与最近播放共用一种记录形状 */
type RecentPlayRecord = OnlinePlayRecord

type CollectionEntry = {
  id: string
  typeLabel: string
  item: OnlineDetailItem
  epName?: string
  url?: string
  progress?: number
  record: RecentPlayRecord
}

const props = defineProps<{ kind: 'favorites' | 'recent' }>()
const emit = defineEmits<{
  open: [item: OnlineDetailItem]
  resume: [record: RecentPlayRecord]
}>()

const category = ref('all')
const route = useRoute()
const items = ref<CollectionEntry[]>([])
const title = computed(() =>
  props.kind === 'favorites' ? '我的收藏' : '最近播放'
)
const description = computed(() =>
  props.kind === 'favorites' ? '收藏的影片与剧集' : '点击卡片直接继续上次播放'
)
const tabs: SegmentedOption[] = [
  { label: '全部', value: 'all' },
  { label: '电影', value: 'movie' },
  { label: '电视剧', value: 'tv' },
]

const typeOf = (item: OnlineDetailItem): 'tv' | 'movie' =>
  item?.type_name === 'tv' || item?.type_name?.includes('剧') ? 'tv' : 'movie'

const normalizeItem = (entry: RecentPlayRecord): OnlineDetailItem => {
  // 新记录的条目在 item 里；旧记录和豆瓣卡片的字段平铺在记录上（豆瓣用 title / cover / type / year）
  const raw = asRecord(entry.item) ?? entry
  if (raw.vod_name) return raw as OnlineDetailItem
  return {
    ...raw,
    _source: 'douban',
    vod_id: asText(raw.url) || asText(raw.title),
    doubanUrl: asText(raw.url),
    doubanKind: raw.kind === 'tv' ? 'tv' : undefined,
    vod_name: asText(raw.title),
    vod_pic: asText(raw.cover),
    type_name: asText(raw.type),
    vod_year: asText(raw.year),
    vod_remarks: '',
  } as OnlineDetailItem
}

const read = (): void => {
  const key =
    props.kind === 'favorites' ? 'media_favorites' : 'online_play_history'
  const own = readStoredArray<RecentPlayRecord>(key)
  const mapped = own.map((entry, index) => {
    const item = normalizeItem(entry)
    const epName = typeof entry.epName === 'string' ? entry.epName : undefined
    const url = typeof entry.url === 'string' ? entry.url : undefined
    const progress =
      typeof entry.progress === 'number' ? entry.progress : undefined
    return {
      id: `${item.vod_id || item.vod_name || 'item'}-${url || index}`,
      item,
      typeLabel: typeOf(item) === 'tv' ? '电视剧' : '电影',
      epName,
      url,
      progress,
      record: { ...entry, item, url, epName, progress },
    } satisfies CollectionEntry
  })
  items.value = mapped.filter(
    entry => entry.item?.vod_name && entry.item?.vod_pic
  )
}

const filteredItems = computed(() =>
  category.value === 'all'
    ? items.value
    : items.value.filter(entry => typeOf(entry.item) === category.value)
)

const onOpen = (entry: CollectionEntry): void => {
  if (props.kind === 'recent' && entry.url) {
    emit('resume', entry.record)
    return
  }
  emit('open', entry.item)
}

/** 空状态：按页面与当前分类说清楚为什么空、怎么才会有内容 */
const empty = computed(() => {
  const favorites = props.kind === 'favorites'
  const label = tabs.find(t => t.value === category.value)?.label ?? ''
  const what = category.value === 'all' ? '' : label
  return {
    icon: favorites ? ('heart' as const) : ('history' as const),
    // 最近播放用完整名词句，避免「全部」分类拼出缺宾语的「还没有播放过」
    title: favorites
      ? `还没有收藏${what}`
      : what
        ? `还没有${what}的播放记录`
        : '还没有播放记录',
    hint: favorites
      ? '点海报或详情页上的心形收藏，影片和剧集会出现在这里'
      : '在线播放过的影片和剧集会出现在这里，点卡片从上次的位置继续',
  }
})

/** 清空记录：不可撤销，先确认 */
const clear = async (): Promise<void> => {
  const ok = await confirmDialog({
    title: props.kind === 'favorites' ? '清空全部收藏？' : '清空播放记录？',
    content: '清空后无法恢复。',
    okText: '清空',
    danger: true,
  })
  if (!ok) return
  localStorage.removeItem(
    props.kind === 'favorites' ? 'media_favorites' : 'online_play_history'
  )
  read()
}

onMounted(read)
watch(() => [route.query.tab, props.kind], read)
</script>

<style scoped>
.library-collection {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 100%;
}

.collection-tabs {
  align-self: flex-start;
}

.collection-empty {
  flex: 1;
}
</style>
