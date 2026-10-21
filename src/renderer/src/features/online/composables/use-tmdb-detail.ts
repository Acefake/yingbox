/**
 * 在线详情页的 TMDB 元信息：按片名搜第一条，再取详情、演职员与剧照。
 * 未配置 TMDB Access Token 时跳过；任何失败都静默（详情页仍可只靠来源数据展示）。
 */
import { type Ref, ref } from 'vue'
import { tmdb } from '../api/online'
import type { TmdbCastMember, TmdbDetail, TmdbImage } from '../types'

/** TMDB /search 的返回：只用第一条的 id */
interface TmdbSearchResult {
  results?: { id: number }[]
}

/** TMDB /credits 的返回 */
interface TmdbCredits {
  cast?: TmdbCastMember[]
  crew?: { job?: string; name: string }[]
}

/** 详情页的 TMDB 元信息（详情、演员、导演、剧照） */
export interface UseTmdbDetailReturn {
  detail: Ref<TmdbDetail | null>
  cast: Ref<TmdbCastMember[]>
  directors: Ref<string[]>
  images: Ref<TmdbImage[]>
  loading: Ref<boolean>
  reset: () => void
  fetchTmdb: (name: string, mediaType: 'movie' | 'tv') => Promise<void>
}

export function useTmdbDetail(): UseTmdbDetailReturn {
  const detail = ref<TmdbDetail | null>(null)
  const cast = ref<TmdbCastMember[]>([])
  const directors = ref<string[]>([])
  const images = ref<TmdbImage[]>([])
  const loading = ref(true)

  const reset = (): void => {
    detail.value = null
    cast.value = []
    directors.value = []
    images.value = []
  }

  const fetchTmdb = async (
    name: string,
    mediaType: 'movie' | 'tv'
  ): Promise<void> => {
    loading.value = true
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
      const ir = await tmdb<{ backdrops?: TmdbImage[] }>(
        `${base}/images`
      ).catch(() => null)
      images.value = (ir?.backdrops || []).slice(0, 30)
    } catch {
      /* silent */
    } finally {
      loading.value = false
    }
  }

  return { detail, cast, directors, images, loading, reset, fetchTmdb }
}
