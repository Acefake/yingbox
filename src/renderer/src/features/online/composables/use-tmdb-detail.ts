/**
 * 在线详情页的 TMDB 元信息：按片名搜第一条，再取详情、演职员与剧照。
 * 未配置 TMDB Access Token 时跳过；任何失败都静默（详情页仍可只靠来源数据展示）。
 * 剧照兜底：给了豆瓣条目 ID 时并行取豆瓣剧照，TMDB 没拿到剧照（没令牌、连不上、条目无图）就用豆瓣的。
 */
import { type Ref, ref } from 'vue'
import { doubanPhotos, tmdb } from '../api/online'
import type { DetailImage, TmdbCastMember, TmdbDetail } from '../types'
import { tmdbImage } from '../utils/detail-sources'

/** TMDB /search 的返回：只用第一条的 id */
interface TmdbSearchResult {
  results?: { id: number }[]
}

/** TMDB /credits 的返回 */
interface TmdbCredits {
  cast?: TmdbCastMember[]
  crew?: { job?: string; name: string }[]
}

/** 豆瓣条目：数字 ID 与类型 */
export interface DoubanRef {
  id: string
  kind: 'movie' | 'tv'
}

/** 详情页的 TMDB 元信息（详情、演员、导演、剧照） */
export interface UseTmdbDetailReturn {
  detail: Ref<TmdbDetail | null>
  cast: Ref<TmdbCastMember[]>
  directors: Ref<string[]>
  images: Ref<DetailImage[]>
  loading: Ref<boolean>
  reset: () => void
  /** douban：豆瓣条目，给了就用豆瓣剧照兜底 */
  fetchTmdb: (
    name: string,
    mediaType: 'movie' | 'tv',
    douban?: DoubanRef | null
  ) => Promise<void>
}

export function useTmdbDetail(): UseTmdbDetailReturn {
  const detail = ref<TmdbDetail | null>(null)
  const cast = ref<TmdbCastMember[]>([])
  const directors = ref<string[]>([])
  const images = ref<DetailImage[]>([])
  const loading = ref(true)

  const reset = (): void => {
    detail.value = null
    cast.value = []
    directors.value = []
    images.value = []
  }

  const fetchTmdb = async (
    name: string,
    mediaType: 'movie' | 'tv',
    douban?: DoubanRef | null
  ): Promise<void> => {
    loading.value = true
    const fallback = douban
      ? doubanPhotos(douban.id, douban.kind).catch(() => [])
      : Promise.resolve([])
    const zh = { language: 'zh-CN' }
    try {
      const sr = await tmdb<TmdbSearchResult>(`/search/${mediaType}`, {
        query: name,
        ...zh,
        page: 1,
      })
      if (sr === null) {
        console.warn(
          '[TMDB] 未配置 Access Token，已跳过 TMDB 查询（请在设置中填写）'
        )
        return
      }
      const first = sr?.results?.[0]
      if (!first) return
      const base = `/${mediaType}/${first.id}`
      const [dr, cr] = await Promise.all([
        tmdb<TmdbDetail>(base, zh),
        tmdb<TmdbCredits>(`${base}/credits`, zh),
      ])
      detail.value = dr
      cast.value = cr?.cast || []
      directors.value = (cr?.crew || [])
        .filter(c => c.job === 'Director')
        .map(c => c.name)
      const ir = await tmdb<{ backdrops?: { file_path: string }[] }>(
        `${base}/images`
      ).catch(() => null)
      images.value = (ir?.backdrops || []).slice(0, 30).map(b => ({
        thumb: tmdbImage('w500', b.file_path),
        full: tmdbImage('original', b.file_path),
      }))
    } catch {
      /* silent */
    } finally {
      if (!images.value.length) images.value = await fallback
      loading.value = false
    }
  }

  return { detail, cast, directors, images, loading, reset, fetchTmdb }
}
