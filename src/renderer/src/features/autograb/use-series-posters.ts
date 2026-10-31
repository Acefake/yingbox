/**
 * 追更列表里剧的海报：总览里带了就用（近期日历里有这部剧时后端一起给），没带的（已完结、休播、
 * 还没进近期日历）向片库按剧 id 补一次，结果按剧缓存（没有海报也记下，不重复查）。
 */
import { type ComputedRef, computed, reactive, watch } from 'vue'

import { fetchItemPoster } from '@/features/library'
import type { AutograbSeries } from '../../../../shared/contract/autograb'

/** 剧 id → 片库里查到的海报；null = 查过没有 */
const fetched = reactive(new Map<number, string | null>())
const asked = new Set<number>()

async function ask(seriesId: number): Promise<void> {
  if (asked.has(seriesId)) return
  asked.add(seriesId)
  try {
    fetched.set(seriesId, await fetchItemPoster(seriesId))
  } catch {
    asked.delete(seriesId)
  }
}

/** 剧 id → 海报原始地址（片库条目的 poster）；没有为 null */
export function useSeriesPosters(
  series: () => AutograbSeries[]
): ComputedRef<Map<number, string | null>> {
  watch(
    series,
    list => {
      for (const s of list) if (!s.poster) void ask(s.seriesId)
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
