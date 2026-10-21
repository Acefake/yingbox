/**
 * 在线详情页的 TMDB 元信息：按片名搜第一条，再取详情、演职员与剧照。
 * 未配置 TMDB Access Token 时跳过；任何失败都静默（详情页仍可只靠来源数据展示）。
 */
import { ref } from 'vue'
import { tmdb } from '../api/online'

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
    const zh = { language: 'zh-CN' }
    try {
      const sr = await tmdb<any>(`/search/${mediaType}`, {
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
        tmdb<any>(base, zh),
        tmdb<any>(`${base}/credits`, zh),
      ])
      detail.value = dr
      cast.value = cr?.cast || []
      directors.value = (cr?.crew || [])
        .filter((c: any) => c.job === 'Director')
        .map((c: any) => c.name)
      const ir = await tmdb<any>(`${base}/images`).catch(() => null)
      images.value = (ir?.backdrops || []).slice(0, 30)
    } catch {
      /* silent */
    } finally {
      loading.value = false
    }
  }

  return { detail, cast, directors, images, loading, reset, fetchTmdb }
}
