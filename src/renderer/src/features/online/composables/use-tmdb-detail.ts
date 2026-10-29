/**
 * 在线详情：按豆瓣 ID 取简介、演职员和剧照，TMDB 按配置并行增强。
 * 豆瓣数据到达即可展示，不等待 TMDB；换条目后丢弃两路旧结果。
 */
import { type Ref, ref } from 'vue'
import { doubanMetadata, tmdb } from '../api/online'
import type { DoubanMetadata } from '../../../../../shared/douban/detail'
import type { DetailImage, TmdbCastMember, TmdbDetail } from '../types'
import { tmdbImage } from '../utils/detail-sources'
import {
  type TmdbCandidate,
  type TmdbIdentity,
  matchingTmdbCandidates,
} from '../utils/tmdb-match'

/** TMDB 搜索结果：按作品身份选择候选。 */
interface TmdbSearchResult {
  results?: TmdbCandidate[]
}

/** TMDB 的图片列表（/images 或详情的 append_to_response=images）：只用背景图 */
interface TmdbImages {
  backdrops?: { file_path: string }[]
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

/** 详情页的豆瓣基础数据与可选 TMDB 增强。 */
export interface UseTmdbDetailReturn {
  douban: Ref<DoubanMetadata | null>
  detail: Ref<TmdbDetail | null>
  cast: Ref<TmdbCastMember[]>
  directors: Ref<string[]>
  images: Ref<DetailImage[]>
  loading: Ref<boolean>
  reset: () => void
  /** douban：按 ID 加载豆瓣详情，与可选 TMDB 请求并行。 */
  fetchTmdb: (
    name: string,
    mediaType: 'movie' | 'tv',
    douban?: DoubanRef | null,
    identity?: Pick<TmdbIdentity, 'year' | 'originalTitle'>
  ) => Promise<void>
}

export function useTmdbDetail(): UseTmdbDetailReturn {
  const doubanDetail = ref<DoubanMetadata | null>(null)
  const detail = ref<TmdbDetail | null>(null)
  const cast = ref<TmdbCastMember[]>([])
  const directors = ref<string[]>([])
  const images = ref<DetailImage[]>([])
  const loading = ref(true)
  /** 每次查询 / 重置递增：换条目后，上一部还在路上的结果直接丢掉 */
  let generation = 0

  const reset = (): void => {
    generation++
    doubanDetail.value = null
    detail.value = null
    cast.value = []
    directors.value = []
    images.value = []
  }

  const fetchTmdb = async (
    name: string,
    mediaType: 'movie' | 'tv',
    douban?: DoubanRef | null,
    identity: Pick<TmdbIdentity, 'year' | 'originalTitle'> = {}
  ): Promise<void> => {
    const mine = ++generation
    const stale = (): boolean => mine !== generation
    loading.value = true
    const fallback = douban
      ? doubanMetadata(douban.id, douban.kind)
          .catch(() => null)
          .then(value => {
            if (!stale()) {
              doubanDetail.value = value
              if (value) {
                if (!images.value.length) images.value = value.images
                loading.value = false
              }
            }
            return value
          })
      : Promise.resolve(null)
    // 不带 language：引擎按设置里的元数据语言补上（scrape.metadataLanguage）
    try {
      const sr = await tmdb<TmdbSearchResult>(`/search/${mediaType}`, {
        query: name,
        page: 1,
      })
      if (sr === null) {
        return
      }
      const metadata = await fallback
      if (stale()) return
      const matches = matchingTmdbCandidates(sr?.results ?? [], {
        title: metadata?.title || name,
        originalTitle: metadata?.originalTitle || identity.originalTitle,
        year: metadata?.year || identity.year,
        kind: mediaType,
      })
      if (matches.length !== 1 || !matches[0].id) return
      const first = matches[0]
      const base = `/${mediaType}/${first.id}`
      // 剧照随详情一起取，并只要中文 / 英文 / 无文字的图：不过滤的 /images 会带上所有语言的海报与标志，
      // 热门条目动辄上百 KB，经代理容易超时，剧照就整段丢了
      const [dr, cr] = await Promise.all([
        tmdb<TmdbDetail & { images?: TmdbImages }>(base, {
          append_to_response: 'images',
          include_image_language: 'zh,en,null',
        }),
        tmdb<TmdbCredits>(`${base}/credits`, {}),
      ])
      if (stale()) return
      detail.value = dr
      cast.value = cr?.cast || []
      directors.value = (cr?.crew || [])
        .filter(c => c.job === 'Director')
        .map(c => c.name)
      let backdrops = dr?.images?.backdrops ?? []
      if (!backdrops.length) {
        const ir = await tmdb<TmdbImages>(`${base}/images`).catch(() => null)
        if (stale()) return
        backdrops = ir?.backdrops ?? []
      }
      if (!backdrops.length && dr?.backdrop_path)
        backdrops = [{ file_path: dr.backdrop_path }]
      images.value = backdrops.slice(0, 30).map(b => ({
        thumb: tmdbImage('w500', b.file_path),
        full: tmdbImage('original', b.file_path),
      }))
    } catch {
      /* silent */
    } finally {
      const metadata = await fallback
      if (!stale()) {
        if (!images.value.length && metadata) images.value = metadata.images
        loading.value = false
      }
    }
  }

  return {
    douban: doubanDetail,
    detail,
    cast,
    directors,
    images,
    loading,
    reset,
    fetchTmdb,
  }
}
