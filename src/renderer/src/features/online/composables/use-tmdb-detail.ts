/**
 * 在线详情页的 TMDB 元信息：按片名搜第一条，再取详情、演职员与剧照。
 * 未配置 TMDB Access Token 时跳过；任何失败都静默（详情页仍可只靠来源数据展示）。
 */
import { ref } from 'vue'
import { getTmdbAccessToken } from '@/features/settings'
import { getJson, withQuery } from '../api/online'

const TMDB = 'https://api.themoviedb.org/3'

export function useTmdbDetail() {
  const detail = ref<any>(null)
  const cast = ref<any[]>([])
  const directors = ref<string[]>([])
  const images = ref<any[]>([])
  const loading = ref(true)

  const reset = () => {
    detail.value = null
    cast.value = []
    directors.value = []
    images.value = []
  }

  const fetchTmdb = async (name: string, mediaType: 'movie' | 'tv') => {
    loading.value = true
    const token = getTmdbAccessToken()
    if (!token) {
      console.warn(
        '[TMDB] 未配置 Access Token，已跳过 TMDB 查询（请在设置中填写）'
      )
      loading.value = false
      return
    }
    const options = {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 8000,
    }
    try {
      const sr = await getJson<any>(
        withQuery(`${TMDB}/search/${mediaType}`, {
          query: name,
          language: 'zh-CN',
          page: 1,
        }),
        options
      )
      const first = sr?.results?.[0]
      if (!first) return
      const base = `${TMDB}/${mediaType}/${first.id}`
      const [dr, cr] = await Promise.all([
        getJson<any>(`${base}?language=zh-CN`, options),
        getJson<any>(`${base}/credits?language=zh-CN`, options),
      ])
      detail.value = dr
      cast.value = cr?.cast || []
      directors.value = (cr?.crew || [])
        .filter((c: any) => c.job === 'Director')
        .map((c: any) => c.name)
      const ir = await getJson<any>(`${base}/images`, options).catch(() => null)
      images.value = (ir?.backdrops || []).slice(0, 30)
    } catch {
      /* silent */
    } finally {
      loading.value = false
    }
  }

  return { detail, cast, directors, images, loading, reset, fetchTmdb }
}
