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
          :title="entry.item.vod_name"
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
    <div v-else class="collection-empty">
      <UiIcon name="heart" class="collection-empty-icon" />
      <p>
        {{
          category === 'all'
            ? '这里还没有内容'
            : `暂无${tabs.find(t => t.value === category)?.label}内容`
        }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import UiIcon from '@/components/ui/UiIcon.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import PageHeader from '@/components/PageHeader.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSegmented, {
  type SegmentedOption,
} from '@/components/ui/UiSegmented.vue'
import { readStoredArray } from '@/utils/storage'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { CmsItem } from '../composables/use-online-search'

type RecentPlayRecord = {
  url?: string
  epName?: string
  progress?: number
  timestamp?: number
  item?: CmsItem
  vod_name?: string
  vod_pic?: string
  [key: string]: unknown
}

type CollectionEntry = {
  id: string
  typeLabel: string
  item: CmsItem
  epName?: string
  url?: string
  progress?: number
  record: RecentPlayRecord
}

const props = defineProps<{ kind: 'favorites' | 'recent' }>()
const emit = defineEmits<{
  open: [item: CmsItem]
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

const typeOf = (item: any) =>
  item?.type_name === 'tv' || item?.type_name?.includes('剧') ? 'tv' : 'movie'

const normalizeItem = (entry: RecentPlayRecord): CmsItem => {
  const raw: any = entry.item || entry
  if (raw?.vod_name) return raw as CmsItem
  return {
    ...raw,
    _source: 'douban',
    vod_id: raw.url || raw.title,
    vod_name: raw.title,
    vod_pic: raw.cover,
    type_name: raw.type,
    vod_year: raw.year || '',
    vod_remarks: '',
  } as CmsItem
}

const read = () => {
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

const onOpen = (entry: CollectionEntry) => {
  if (props.kind === 'recent' && entry.url) {
    emit('resume', entry.record)
    return
  }
  emit('open', entry.item)
}

const clear = () => {
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
  display: grid;
  place-items: center;
  min-height: 300px;
  color: var(--text-tertiary);
}

.collection-empty-icon {
  width: 40px;
  height: 40px;
  color: var(--text-quaternary);
}
</style>
