/**
 * 网盘页 Hero 的影片匹配：搜索词变了，防抖后问 TMDB（经在线引擎的 online.tmdb，令牌不进渲染层）
 * 找一部对得上的片，拿剧照 / 标志 / 年份类型时长评分换掉默认海报。
 * - 新词一来先清掉旧片（旧片配不上新结果），晚到的旧响应作废；
 * - 没配 TMDB 令牌、请求失败、没对上，都静默保持默认海报。
 */
import { type Ref, getCurrentScope, onScopeDispose, ref, watch } from 'vue'

import {
  type HeroMatch,
  type TmdbDetail,
  type TmdbSearchHit,
  heroFromTmdb,
  matchQuery,
  pickTmdbHit,
} from '../utils/hero-match'

/** TMDB v3 请求（未配置令牌时返回 null） */
export type TmdbFetch = (
  path: string,
  query?: Record<string, string | number>
) => Promise<unknown>

/** 依赖：TMDB 请求与防抖时长 */
export interface HeroMatchDeps {
  tmdb: () => Promise<TmdbFetch>
  delayMs?: number
}

/**
 * @param keyword 已提交的搜索词（每次搜索后更新，不跟着输入框每个字变）
 */
export function useHeroMatch(
  keyword: Ref<string>,
  deps: HeroMatchDeps
): { match: Ref<HeroMatch | null> } {
  const match = ref<HeroMatch | null>(null)
  const delay = deps.delayMs ?? 300
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  async function lookup(query: string, id: number): Promise<void> {
    try {
      const tmdb = await deps.tmdb()
      const found = (await tmdb('/search/multi', {
        query,
        language: 'zh-CN',
        page: 1,
        include_adult: 'false',
      })) as { results?: TmdbSearchHit[] } | null
      if (id !== seq) return
      const hit = pickTmdbHit(found?.results ?? [], query)
      if (!hit) return
      const detail = (await tmdb(`/${hit.media_type}/${hit.id}`, {
        language: 'zh-CN',
        append_to_response: 'images',
        include_image_language: 'zh,en,null',
      })) as TmdbDetail | null
      if (id !== seq) return
      match.value = heroFromTmdb(hit, detail ?? {})
    } catch {
      // 匹配只是锦上添花：失败保持默认海报
    }
  }

  watch(keyword, value => {
    const id = ++seq
    clearTimeout(timer)
    match.value = null
    const query = matchQuery(value)
    if (!query) return
    timer = setTimeout(() => void lookup(query, id), delay)
  })

  if (getCurrentScope())
    onScopeDispose(() => {
      seq++
      clearTimeout(timer)
    })
  return { match }
}
