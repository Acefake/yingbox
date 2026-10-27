/**
 * 网盘页 Hero 的影片匹配：搜索词变了，防抖后问 TMDB（经在线引擎的 online.tmdb，令牌不进渲染层）
 * 找一部对得上的片，拿剧照 / 标志 / 年份类型时长评分换掉默认海报。
 * - 新词一来先清掉旧片（旧片配不上新结果），晚到的旧响应作废；
 * - 没配 TMDB 令牌、请求失败、没对上，都静默保持默认海报；
 * - 搜索词带集号 / 季号（「嫁金钗 S01E20」）时用去掉集号的剧名、只在剧集里找。
 */
import { type Ref, getCurrentScope, onScopeDispose, ref, watch } from 'vue'

import { parseSearchIntent } from '../../../../../shared/netdisk/search-intent'
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

  async function lookup(
    query: string,
    tvOnly: boolean,
    id: number
  ): Promise<void> {
    try {
      const tmdb = await deps.tmdb()
      const found = (await tmdb(tvOnly ? '/search/tv' : '/search/multi', {
        query,
        page: 1,
        include_adult: 'false',
      })) as { results?: TmdbSearchHit[] } | null
      if (id !== seq) return
      // /search/tv 的结果不带 media_type，补上
      const results = (found?.results ?? []).map(item =>
        tvOnly ? { ...item, media_type: 'tv' } : item
      )
      const hit = pickTmdbHit(results, query)
      if (!hit) return
      const detail = (await tmdb(`/${hit.media_type}/${hit.id}`, {
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
    const intent = parseSearchIntent(value)
    const query = matchQuery(intent.query)
    if (!query) return
    const tvOnly = intent.kind === 'tv'
    timer = setTimeout(() => void lookup(query, tvOnly, id), delay)
  })

  if (getCurrentScope())
    onScopeDispose(() => {
      seq++
      clearTimeout(timer)
    })
  return { match }
}
