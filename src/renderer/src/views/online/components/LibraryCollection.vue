<template>
  <div class="library-collection">
    <header class="collection-header">
      <div><h1>{{ title }}</h1><p>{{ description }}</p></div>
      <button v-if="items.length" class="clear-btn" type="button" @click="clear">清空</button>
    </header>
    <div class="collection-tabs" role="tablist" aria-label="媒体类型">
      <button v-for="tab in tabs" :key="tab.value" type="button" :class="{ active: category === tab.value }" @click="category = tab.value">{{ tab.label }}</button>
    </div>
    <div v-if="filteredItems.length" class="collection-grid">
      <article v-for="item in filteredItems" :key="item.id" class="collection-card" @click="emit('open', item.item)">
        <img :src="item.item.vod_pic" :alt="item.item.vod_name" loading="lazy" @error="onImgError" />
        <div><h3>{{ item.item.vod_name }}</h3><p>{{ item.typeLabel }}<span v-if="item.item.vod_year"> · {{ item.item.vod_year }}</span></p></div>
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

const props = defineProps<{ kind: 'favorites' | 'recent' }>()
const emit = defineEmits<{ open: [item: CmsItem] }>()
const category = ref('all')
const route = useRoute()
const items = ref<Array<{ id: string; typeLabel: string; item: CmsItem }>>([])
const title = computed(() => props.kind === 'favorites' ? '我的收藏' : '最近播放')
const description = computed(() => props.kind === 'favorites' ? '豆瓣热门中的收藏内容' : '豆瓣热门中的最近观看内容')
const tabs = [{ label: '全部', value: 'all' }, { label: '电影', value: 'movie' }, { label: '电视剧', value: 'tv' }]
const typeOf = (item: any) => (item.type_name === 'tv' || item.type_name?.includes('剧')) ? 'tv' : item._uid || item.vod_play_url?.includes('m3u8') ? 'av' : 'movie'
const read = () => {
  const key = props.kind === 'favorites' ? 'media_favorites' : 'online_play_history'
  const own = readStoredArray<Record<string, any>>(key)
  const mapped = own.map(entry => {
    const raw = entry.item || entry
    const item = raw.vod_name ? raw : {
      ...raw, _source: 'douban', vod_id: raw.url || raw.title,
      vod_name: raw.title, vod_pic: raw.cover, type_name: raw.type,
      vod_year: raw.year || '', vod_remarks: '',
    }
    return { item, typeLabel: typeOf(item) === 'tv' ? '电视剧' : '电影' }
  })
  items.value = mapped.filter(entry => entry.item?.vod_name && entry.item?.vod_pic).map((entry, index) => ({ id: `${entry.item.vod_name}-${index}`, ...entry }))
}
const filteredItems = computed(() => category.value === 'all' ? items.value : items.value.filter(entry => typeOf(entry.item) === category.value))
const clear = () => { localStorage.removeItem(props.kind === 'favorites' ? 'media_favorites' : 'online_play_history'); read() }
const onImgError = (event: Event) => { (event.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="220"><rect width="100%" height="100%" fill="%23232a33"/></svg>' }
onMounted(read)
watch(() => [route.query.tab, props.kind], read)
</script>

<style scoped>
.library-collection { display:flex; flex-direction:column; gap:18px; min-height:100%; }
.collection-header { display:flex; align-items:flex-start; justify-content:space-between; }
.collection-header h1 { margin:0; color:#f5f7f8; font-size:21px; }
.collection-header p { margin:6px 0 0; color:rgba(255,255,255,.42); font-size:13px; }
.collection-tabs { display:flex; gap:20px; padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,.08); }
.collection-tabs button { padding:0; border:0; color:rgba(255,255,255,.56); background:transparent; font-size:14px; cursor:pointer; }
.collection-tabs button.active { color:var(--primary); font-weight:600; }
.collection-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:24px 18px; }
.collection-card { min-width:0; cursor:pointer; }
.collection-card img { display:block; width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:9px; background:#222a32; transition:transform .18s ease; }
.collection-card:hover img { transform:translateY(-2px); }
.collection-card h3 { margin:9px 2px 0; overflow:hidden; color:rgba(255,255,255,.86); font-size:13px; font-weight:500; text-overflow:ellipsis; white-space:nowrap; }
.collection-card p { margin:4px 2px 0; color:rgba(255,255,255,.4); font-size:12px; }
.collection-empty { display:grid; place-items:center; min-height:300px; color:rgba(255,255,255,.36); }
.collection-empty span { font-size:42px; color:rgba(255,255,255,.18); }
@media (max-width:760px) { .collection-grid { grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:18px 12px; } }
</style>
