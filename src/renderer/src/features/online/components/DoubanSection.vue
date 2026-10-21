<template>
  <div class="home-section">
    <PageHeader title="豆瓣热门">
      <template #actions
        ><UiIconButton
          icon="refresh"
          label="换一批热门影片"
          :loading="doubanLoading"
          @click="nextPage"
      /></template>
    </PageHeader>
    <MediaFilterBar
      :rows="filterRows"
      :model-value="{ type: doubanType, tag: doubanTag }"
      @update:model-value="applyFilter"
    />

    <div v-if="doubanLoading" class="db-loading">加载中...</div>
    <div v-else-if="doubanError" class="db-error">
      <UiIcon name="warning" /> 豆瓣数据加载失败，请稍后重试
    </div>
    <UiVirtualGrid
      v-else
      :items="doubanItems"
      class="ui-poster-grid"
      :item-key="item => item.url"
    >
      <template #default="{ item }">
        <UiPosterCard
          thumb
          :title="item.title"
          :cover="item.cover"
          :rating="item.rate"
          :subtitle="[item.year, item.type].filter(Boolean).join(' · ')"
          :favorite="isFavorite(item)"
          @open="emit('open', item)"
          @toggle-favorite="toggleFavorite(item)"
        />
      </template>
    </UiVirtualGrid>
  </div>
</template>

<script setup lang="ts">
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import PageHeader from '@/components/PageHeader.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import { readStoredArray, saveStoredArray } from '@/utils/storage'
import { computed, onMounted, ref } from 'vue'
import { getJson, tmdb } from '../api/online'
import type { TmdbDetail } from '../types'

/** TMDB 搜索结果的一条（/search/multi 多一个 media_type） */
type TmdbHit = TmdbDetail & { media_type?: string }
import MediaFilterBar, {
  type MediaFilterRow,
} from '@/components/MediaFilterBar.vue'

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
const MOVIE_TAGS = [
  '热门',
  '最新',
  '经典',
  '豆瓣高分',
  '冷门佳片',
  '华语',
  '欧美',
  '韩国',
  '日本',
  '动作',
  '喜剧',
  '爱情',
  '科幻',
  '悬疑',
  '恐怖',
]
const TV_TAGS = [
  '热门',
  '美剧',
  '英剧',
  '韩剧',
  '日剧',
  '国产剧',
  '港剧',
  '日本动画',
  '综艺',
  '纪录片',
]
const PAGE_SIZE = 16

const doubanType = ref<DoubanType>('movie')
const doubanTag = ref('热门')
const doubanItems = ref<DoubanItem[]>([])
const doubanLoading = ref(false)
const doubanError = ref(false)
const doubanPage = ref(0)
const favorites = ref<DoubanItem[]>(
  readStoredArray<DoubanItem>('media_favorites')
)

const currentTags = computed(() =>
  doubanType.value === 'movie' ? MOVIE_TAGS : TV_TAGS
)
const filterRows = computed<MediaFilterRow[]>(() => [
  {
    key: 'type',
    label: '类型',
    options: [
      { label: '电影', value: 'movie' },
      { label: '电视剧', value: 'tv' },
    ],
  },
  {
    key: 'tag',
    label: '分类',
    options: currentTags.value.map(tag => ({ label: tag, value: tag })),
  },
])
const applyFilter = (next: Record<string, string>): void => {
  if (next.type && next.type !== doubanType.value)
    switchType(next.type as DoubanType)
  if (next.tag && next.tag !== doubanTag.value) switchTag(next.tag)
}
const isFavorite = (item: DoubanItem): boolean =>
  favorites.value.some(entry => entry.url === item.url)
const toggleFavorite = (item: DoubanItem): void => {
  favorites.value = isFavorite(item)
    ? favorites.value.filter(entry => entry.url !== item.url)
    : [item, ...favorites.value]
  saveStoredArray('media_favorites', favorites.value)
}

const fetchDouban = async (): Promise<void> => {
  doubanLoading.value = true
  doubanError.value = false
  const apiUrl = `https://movie.douban.com/j/search_subjects?type=${doubanType.value}&tag=${encodeURIComponent(doubanTag.value)}&sort=recommend&page_limit=${PAGE_SIZE}&page_start=${doubanPage.value * PAGE_SIZE}`

  type RawSubject = { title: string; cover: string; rate: string; url: string }

  const stripSeason = (t: string): string =>
    t
      .replace(
        /\s*(第[一二三四五六七八九十百\d]+季|Season\s*\d+|[Ss]\d+)\s*/g,
        ''
      )
      .trim()

  const parseSubjects = (data: { subjects?: RawSubject[] }): void => {
    doubanItems.value = (data.subjects || []).map(s => ({
      title: s.title,
      searchTitle: s.title,
      original_title: '',
      cover: '',
      coverSrc: s.cover,
      rate: s.rate || '暂无',
      url: s.url,
      year: '',
      type: '',
      overview: '',
    }))
    loadCoversViaTmdb()
  }

  const loadCoversViaTmdb = async (): Promise<void> => {
    const items = doubanItems.value
    const imgBase = 'https://images.tmdb.org/t/p/w342'
    const isTv = doubanType.value === 'tv'
    // 引擎没有令牌时 tmdb() 返回 null：整批停下，不逐条重试
    const NO_TOKEN = new Error('TMDB 未配置令牌')
    const searchFirst = async (
      path: string,
      q: string
    ): Promise<TmdbHit | null> => {
      // /search/multi 的结果多一个 media_type
      const res = await tmdb<{ results?: TmdbHit[] }>(path, {
        query: q,
        language: 'zh-CN',
        page: 1,
      })
      if (res === null) throw NO_TOKEN
      return res?.results?.[0] ?? null
    }

    const extractNum = (t: string): string | null => {
      const zh: Record<string, string> = {
        一: '1',
        二: '2',
        三: '3',
        四: '4',
        五: '5',
        六: '6',
        七: '7',
        八: '8',
        九: '9',
        十: '10',
      }
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

    const queryTmdb = (q: string): Promise<TmdbHit | null> =>
      searchFirst(isTv ? '/search/tv' : '/search/movie', q)

    const searchTmdb = async (title: string): Promise<TmdbHit | null> => {
      for (const v of buildVariants(title)) {
        const r = await queryTmdb(v)
        if (r) return r
      }
      return searchFirst('/search/multi', stripSeason(title))
    }

    const concurrency = 4
    let idx = 0
    const worker = async (): Promise<void> => {
      while (idx < items.length) {
        const i = idx++
        const item = items[i]
        try {
          const first = await searchTmdb(item.title)
          items[i].cover = first?.poster_path
            ? imgBase + first.poster_path
            : item.coverSrc
          if (first) {
            const date = first.release_date || first.first_air_date || ''
            items[i].year = date ? date.slice(0, 4) : ''
            const mt = first.media_type
            items[i].type =
              mt === 'tv'
                ? '剧集'
                : mt === 'movie'
                  ? '电影'
                  : isTv
                    ? '剧集'
                    : '电影'
            items[i].overview = first.overview || ''
            items[i].original_title =
              first.original_title || first.original_name || ''
            const tmdbName = first.name || first.title || ''
            if (tmdbName) items[i].searchTitle = tmdbName
          }
        } catch (error) {
          if (error === NO_TOKEN) {
            if (idx < items.length)
              console.warn(
                '[TMDB] 未配置 Access Token，已跳过封面补全（请在设置中填写）'
              )
            idx = items.length
            return
          }
          items[i].cover = item.coverSrc
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
  }

  try {
    parseSubjects(await getJson(apiUrl, { timeoutMs: 10000 }))
  } catch {
    try {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`
      const res = await getJson<{ contents: string }>(proxyUrl, {
        timeoutMs: 12000,
      })
      parseSubjects(JSON.parse(res.contents))
    } catch {
      doubanError.value = true
    }
  } finally {
    doubanLoading.value = false
  }
}

const switchType = (t: DoubanType): void => {
  doubanType.value = t
  doubanTag.value = '热门'
  doubanPage.value = 0
  fetchDouban()
}

const switchTag = (tag: string): void => {
  doubanTag.value = tag
  doubanPage.value = 0
  fetchDouban()
}

const nextPage = (): void => {
  doubanPage.value = (doubanPage.value + 1) % 10
  fetchDouban()
}

onMounted(fetchDouban)
</script>

<style scoped>
.home-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.db-loading {
  text-align: center;
  padding: var(--space-8);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.db-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-7);
  color: var(--danger);
  font-size: var(--text-sm);
}
</style>
