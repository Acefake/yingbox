/**
 * 追更列表里剧的海报，保证尽量都有：总览里带了就用（近期日历里有这部剧时后端一起给）；
 * 没带的先向片库按剧 id 取；片库里找不到（条目 id 随重新扫描变过、没刮到海报）再按剧名问 TMDB。
 * 结果按剧缓存，没有也记下，不重复查。
 */
import { type ComputedRef, computed, reactive, watch } from 'vue'

import { fetchItemPoster } from '@/features/library'
import { onlineAvailable, tmdb } from '@/features/online'
import type { AutograbSeries } from '../../../../shared/contract/autograb'

import { tmdbSearchPoster } from './series-poster-rules'

/** 剧 id → 补来的海报；null = 查过没有 */
const fetched = reactive(new Map<number, string | null>())
const asked = new Set<number>()

/** 按剧名问 TMDB；没配令牌、没有在线引擎或失败都当没有 */
async function searchPoster(title: string): Promise<string | null> {
  if (!onlineAvailable() || !title) return null
  try {
    return tmdbSearchPoster(await tmdb('/search/tv', { query: title }))
  } catch {
    return null
  }
}

async function ask(series: AutograbSeries): Promise<void> {
  if (asked.has(series.seriesId)) return
  asked.add(series.seriesId)
  let poster: string | null = null
  try {
    poster = await fetchItemPoster(series.seriesId)
  } catch {
    // 片库查不到就按剧名找
  }
  fetched.set(series.seriesId, poster ?? (await searchPoster(series.title)))
}

/** 剧 id → 海报原始地址（片库条目的 poster 或 TMDB 地址）；没有为 null */
export function useSeriesPosters(
  series: () => AutograbSeries[]
): ComputedRef<Map<number, string | null>> {
  watch(
    series,
    list => {
      for (const s of list) if (!s.poster) void ask(s)
    },
    { immediate: true }
  )
  return computed(
    () =>
      new Map(
        series().map(s => [
          s.seriesId,
          s.poster ?? fetched.get(s.seriesId) ?? null,
        ])
      )
  )
}
