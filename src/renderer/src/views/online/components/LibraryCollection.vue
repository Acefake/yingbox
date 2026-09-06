<template>
  <div class="library-collection">
    <header class="collection-header">
      <div><h1 class="yb-page-title">{{ title }}</h1><p class="yb-section-subtitle">{{ description }}</p></div>
      <button v-if="items.length" class="yb-ghost-btn" type="button" @click="clear">清空</button>
    </header>
    <div class="collection-tabs" role="tablist" aria-label="媒体类型">
      <button v-for="tab in tabs" :key="tab.value" type="button" :class="{ active: category === tab.value }" @click="category = tab.value">{{ tab.label }}</button>
    </div>
    <div v-if="filteredItems.length" class="yb-poster-grid">
      <article
        v-for="entry in filteredItems"
        :key="entry.id"
        class="yb-poster-card"
        @click="onOpen(entry)"
      >
        <div class="yb-poster-media">
          <img :src="entry.item.vod_pic" :alt="entry.item.vod_name" loading="lazy" @error="onImgError" />
        </div>
        <div class="yb-poster-info">
          <h3 class="yb-poster-title" :title="entry.item.vod_name">{{ entry.item.vod_name }}</h3>
          <p class="yb-poster-meta">
            <span class="yb-poster-chip is-accent">{{ entry.typeLabel }}</span>
            <span v-if="entry.epName" class="yb-poster-chip">{{ entry.epName }}</span>
            <span v-else-if="entry.item.vod_year" class="yb-poster-chip">{{ entry.item.vod_year }}</span>
          </p>
        </div>
      </article>
    </div>
    <div v-else class="collection-empty"><span>◇</span><p>{{ category === 'all' ? '这里还没有内容' : `暂无${tabs.find(t => t.value === category)?.label}内容` }}</p></div>
  </div>
</template>

<script setup lang="ts">
import { readStoredArray } from '@/utils/storage'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { CmsItem } from '../composables/use-online-search'

export type RecentPlayRecord = {
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
const title = computed(() => props.kind === 'favorites' ? '我的收藏' : '最近播放')
const description = computed(() =>
  props.kind === 'favorites'
    ? '收藏的影片与剧集'
    : '点击卡片直接继续上次播放'
)
const tabs = [
  { label: '全部', value: 'all' },
  { label: '电影', value: 'movie' },
  { label: '电视剧', value: 'tv' },
]

const typeOf = (item: any) =>
  (item?.type_name === 'tv' || item?.type_name?.includes('剧')) ? 'tv' : 'movie'

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
  const key = props.kind === 'favorites' ? 'media_favorites' : 'online_play_history'
  const own = readStoredArray<RecentPlayRecord>(key)
  const mapped = own.map((entry, index) => {
    const item = normalizeItem(entry)
    const epName = typeof entry.epName === 'string' ? entry.epName : undefined
    const url = typeof entry.url === 'string' ? entry.url : undefined
    const progress = typeof entry.progress === 'number' ? entry.progress : undefined
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
  items.value = mapped.filter(entry => entry.item?.vod_name && entry.item?.vod_pic)
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
  localStorage.removeItem(props.kind === 'favorites' ? 'media_favorites' : 'online_play_history')
  read()
}

const onImgError = (event: Event) => {
  ;(event.target as HTMLImageElement).src =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="220"><rect width="100%" height="100%" fill="%239ca3af"/></svg>'
}

onMounted(read)
watch(() => [route.query.tab, props.kind], read)
</script>

<style scoped>
.library-collection {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
}

.collection-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.collection-tabs {
  display: flex;
  gap: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--separator);
}

.collection-tabs button {
  position: relative;
  padding: 0 0 10px;
  border: 0;
  color: var(--text-secondary);
  background: transparent;
  font-size: var(--text-md);
  cursor: pointer;
  transition: var(--transition-fast);
}

.collection-tabs button:hover {
  color: var(--text-primary);
}

.collection-tabs button.active {
  color: var(--accent-text);
  font-weight: var(--font-weight-semibold);
}

.collection-tabs button.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 1px;
  background: var(--accent);
}

.collection-empty {
  display: grid;
  place-items: center;
  min-height: 300px;
  color: var(--text-tertiary);
}

.collection-empty span {
  font-size: 42px;
  color: var(--text-quaternary);
}
</style>