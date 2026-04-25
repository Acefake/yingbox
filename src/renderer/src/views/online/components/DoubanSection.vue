<template>
  <div class="home-section">
    <div class="section-header">
      <span class="section-title">豆瓣热门</span>
      <div class="douban-type-btns">
        <button :class="['type-btn', doubanType === 'movie' ? 'active' : '']"
          @click="switchType('movie')">电影</button>
        <button :class="['type-btn', doubanType === 'tv' ? 'active' : '']"
          @click="switchType('tv')">电视剧</button>
      </div>
      <button class="clear-btn" @click="nextPage">换一批</button>
    </div>

    <div class="douban-tags">
      <button v-for="tag in currentTags" :key="tag"
        :class="['dtag', doubanTag === tag ? 'active' : '']"
        @click="switchTag(tag)">{{ tag }}</button>
    </div>

    <div v-if="doubanLoading" class="db-loading">加载中...</div>
    <div v-else-if="doubanError" class="db-error">⚠ 豆瓣数据加载失败，请稍后重试</div>
    <div v-else class="result-grid">
      <div v-for="item in doubanItems" :key="item.url" class="result-card" @click="emit('open', item)">
        <div class="card-poster">
          <img :src="item.cover" :alt="item.title" loading="lazy" referrerpolicy="no-referrer" @error="onImgError" />
          <div class="card-overlay">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="white"><path d="M8 5v14l11-7z" /></svg>
          </div>
          <div class="rate-badge">★ {{ item.rate }}</div>
        </div>
        <div class="card-info">
          <div class="card-title" :title="item.title">{{ item.title }}</div>
          <div class="card-meta">
            <span v-if="item.year" class="card-year">{{ item.year }}</span>
            <span v-if="item.type" class="card-type">{{ item.type }}</span>
          </div>
          <div v-if="item.overview" class="card-overview">{{ item.overview }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { getTmdbAccessToken } from '@/stores/scrape-provider-store'

export interface DoubanItem {
  title: string
  searchTitle: string
  original_title: string
  cover: string
  coverSrc: string
  rate: string
  url: string
  year: string
  type: string
  overview: string
}

const emit = defineEmits<{ (e: 'open', item: DoubanItem): void }>()

type DoubanType = 'movie' | 'tv'
const MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖']
const TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片']
const PAGE_SIZE = 16

const doubanType = ref<DoubanType>('movie')
const doubanTag = ref('热门')
const doubanItems = ref<DoubanItem[]>([])
const doubanLoading = ref(false)
const doubanError = ref(false)
const doubanPage = ref(0)

const currentTags = computed(() => doubanType.value === 'movie' ? MOVIE_TAGS : TV_TAGS)

const onImgError = (e: Event) => {
  (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160"><rect width="120" height="160" fill="%23374151"/><text x="60" y="85" text-anchor="middle" fill="%236b7280" font-size="12">无图</text></svg>'
}

const fetchDouban = async () => {
  doubanLoading.value = true
  doubanError.value = false
  const apiUrl = `https://movie.douban.com/j/search_subjects?type=${doubanType.value}&tag=${encodeURIComponent(doubanTag.value)}&sort=recommend&page_limit=${PAGE_SIZE}&page_start=${doubanPage.value * PAGE_SIZE}`

  type RawSubject = { title: string; cover: string; rate: string; url: string }

  const stripSeason = (t: string) =>
    t.replace(/\s*(第[一二三四五六七八九十百\d]+季|Season\s*\d+|[Ss]\d+)\s*/g, '').trim()

  const parseSubjects = (data: { subjects?: RawSubject[] }) => {
    doubanItems.value = (data.subjects || []).map(s => ({
      title: s.title, searchTitle: s.title, original_title: '',
      cover: '', coverSrc: s.cover, rate: s.rate || '暂无',
      url: s.url, year: '', type: '', overview: '',
    }))
    loadCoversViaTmdb()
  }

  const loadCoversViaTmdb = async () => {
    const items = doubanItems.value
    const token = getTmdbAccessToken()
    const imgBase = 'https://images.tmdb.org/t/p/w342'
    const headers = { Authorization: `Bearer ${token}` }
    const isTv = doubanType.value === 'tv'

    const extractNum = (t: string): string | null => {
      const zh: Record<string, string> = { '一':'1','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9','十':'10' }
      let m = t.match(/第([一二三四五六七八九十\d]+)季/)
      if (m) return zh[m[1]] ?? m[1]
      m = t.match(/[Ss](?:eason\s*)?0*(\d+)/)
      if (m) return m[1]
      return null
    }

    const buildVariants = (title: string): string[] => {
      const variants = [title]
      const compact = title.replace(/\s+/g, '')
      if (compact !== title) variants.push(compact)
      const num = extractNum(title)
      if (num) variants.push(`${stripSeason(title)}S${num.padStart(2, '0')}`)
      const stripped = stripSeason(title)
      if (stripped !== title) variants.push(stripped)
      return Array.from(new Set(variants))
    }

    const queryTmdb = async (q: string) => {
      const endpoint = isTv
        ? 'https://api.themoviedb.org/3/search/tv'
        : 'https://api.themoviedb.org/3/search/movie'
      const res = await axios.get(endpoint, { params: { query: q, language: 'zh-CN', page: 1 }, headers, timeout: 8000 })
      return res.data?.results?.[0] ?? null
    }

    const searchTmdb = async (title: string) => {
      for (const v of buildVariants(title)) {
        const r = await queryTmdb(v)
        if (r) return r
      }
      const res = await axios.get('https://api.themoviedb.org/3/search/multi', {
        params: { query: stripSeason(title), language: 'zh-CN', page: 1 }, headers, timeout: 8000,
      })
      return res.data?.results?.[0] ?? null
    }

    const concurrency = 4
    let idx = 0
    const worker = async () => {
      while (idx < items.length) {
        const i = idx++
        const item = items[i]
        try {
          const first = await searchTmdb(item.title)
          items[i].cover = first?.poster_path ? imgBase + first.poster_path : item.coverSrc
          if (first) {
            const date = first.release_date || first.first_air_date || ''
            items[i].year = date ? date.slice(0, 4) : ''
            const mt = first.media_type
            items[i].type = mt === 'tv' ? '剧集' : mt === 'movie' ? '电影' : isTv ? '剧集' : '电影'
            items[i].overview = first.overview || ''
            items[i].original_title = first.original_title || first.original_name || ''
            const tmdbName = first.name || first.title || ''
            if (tmdbName) items[i].searchTitle = tmdbName
          }
        } catch {
          items[i].cover = item.coverSrc
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
  }

  try {
    const res = await axios.get(apiUrl, { timeout: 10000 })
    parseSubjects(res.data)
  } catch {
    try {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`
      const res = await axios.get(proxyUrl, { timeout: 12000 })
      parseSubjects(JSON.parse(res.data.contents))
    } catch {
      doubanError.value = true
    }
  } finally {
    doubanLoading.value = false
  }
}

const switchType = (t: DoubanType) => {
  doubanType.value = t
  doubanTag.value = '热门'
  doubanPage.value = 0
  fetchDouban()
}

const switchTag = (tag: string) => {
  doubanTag.value = tag
  doubanPage.value = 0
  fetchDouban()
}

const nextPage = () => {
  doubanPage.value = (doubanPage.value + 1) % 10
  fetchDouban()
}

onMounted(fetchDouban)
</script>

<style scoped>
.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  flex: 1;
}

.clear-btn {
  font-size: 11px;
  padding: 2px 10px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
}

.clear-btn:hover { color: rgba(255, 255, 255, 0.8); }

.douban-type-btns { display: flex; gap: 4px; }

.type-btn {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all 0.15s;
}

.type-btn.active {
  background: rgba(99, 102, 241, 0.4);
  border-color: rgba(99, 102, 241, 0.6);
  color: white;
}

.douban-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 12px;
}

.dtag {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.09);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all 0.15s;
}

.dtag.active {
  background: rgba(239, 68, 68, 0.3);
  border-color: rgba(239, 68, 68, 0.5);
  color: white;
}

.dtag:hover:not(.active) {
  background: rgba(255, 255, 255, 0.12);
  color: white;
}

.db-loading {
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
}

.db-error {
  text-align: center;
  padding: 30px;
  color: rgba(248, 113, 113, 0.8);
  font-size: 13px;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
}

.result-card {
  cursor: pointer;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: transform 0.2s, border-color 0.2s;
}

.result-card:hover {
  transform: translateY(-3px);
  border-color: rgba(99, 102, 241, 0.5);
}

.card-poster {
  position: relative;
  aspect-ratio: 2/3;
  overflow: hidden;
  background: #1f2937;
}

.card-poster img { width: 100%; height: 100%; object-fit: cover; }

.card-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.result-card:hover .card-overlay { opacity: 1; }

.rate-badge {
  position: absolute;
  bottom: 6px;
  left: 6px;
  background: rgba(0, 0, 0, 0.65);
  color: #fbbf24;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
}

.card-info { padding: 8px; }

.card-title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.card-meta { display: flex; flex-wrap: wrap; gap: 4px; margin: 3px 0; }

.card-year {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.55);
}

.card-type {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(99, 102, 241, 0.25);
  color: rgba(180, 180, 255, 0.85);
}

.card-overview {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.4;
  margin-top: 3px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  overflow: hidden;
}
</style>
