/**
 * 库外发现的取数：豆瓣筛选拿片单（中文片名、评分、年份、海报）→ TMDB 只补 id 与原名 → 和本地媒体库去重。
 *
 * - 豆瓣走 online.doubanBrowse（引擎按条件选接口、缓存、熔断）；
 * - TMDB 走 online.tmdb（令牌在主进程 / 引擎），没配令牌时返回 null，整批改按片名 + 年份去重；
 * - 本地库只查 tmdb 来源的媒体库（片名 FTS），私密分区不参与。
 * 在线模块按需加载（它的首页豆瓣卡也会反过来打开本模块的候选面板，不静态互相引用）。
 */
import { type LibraryLookup, findLibraryItems } from '@/features/library'

import type {
  DoubanQuery,
  DoubanSubject,
} from '../../../../shared/douban/query'
import type { LibraryItemSummary } from '../../../../shared/library/ipc'
import {
  type DiscoverTitle,
  findInLibrary,
  splitByLibrary,
  yearOf,
} from './discover-rules'

/** 一次最多看几条豆瓣结果 */
const MAX_SUBJECTS = 12
const CONCURRENCY = 4

/** 取数结果：库里已有的（可直接播放）与库外的 */
export interface DiscoverResult {
  local: Array<{ title: DiscoverTitle; item: LibraryItemSummary }>
  missing: DiscoverTitle[]
}

/** TMDB 搜索结果的一条 */
interface TmdbHit {
  id: number
  original_title?: string
  original_name?: string
}

/** 豆瓣条目 → 库外片子（TMDB 字段待补） */
export function titleFromSubject(subject: DoubanSubject): DiscoverTitle {
  return {
    doubanId: subject.id,
    kind: subject.kind,
    title: subject.title,
    originalTitle: '',
    year: yearOf(subject.year),
    rate: subject.rate,
    cover: subject.cover,
    tmdbId: null,
  }
}

/** 并发跑一批任务 */
async function eachLimited<T>(
  items: readonly T[],
  run: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) await run(items[next++])
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
}

/**
 * 按豆瓣条件找片并和本地库去重。
 * @param query 豆瓣浏览条件（普通对象）
 * @param signal 取消信号（助手被收起时停下）
 */
export async function discoverTitles(
  query: DoubanQuery,
  signal?: AbortSignal
): Promise<DiscoverResult> {
  const { doubanBrowse, tmdb } = await import('@/features/online')
  const page = await doubanBrowse({ ...query }, 0)
  const titles = page.items.slice(0, MAX_SUBJECTS).map(titleFromSubject)
  let tmdbReady = true
  const found = new Map<string, LibraryItemSummary>()

  await eachLimited(titles, async title => {
    if (signal?.aborted) return
    if (tmdbReady) {
      try {
        const res = (await tmdb(
          title.kind === 'tv' ? '/search/tv' : '/search/movie',
          {
            query: title.title,
            page: 1,
            ...(title.year
              ? {
                  [title.kind === 'tv' ? 'first_air_date_year' : 'year']:
                    title.year,
                }
              : {}),
          }
        )) as { results?: TmdbHit[] } | null
        if (res === null) tmdbReady = false
        const hit = res?.results?.[0]
        if (hit) {
          title.tmdbId = String(hit.id)
          title.originalTitle = hit.original_title || hit.original_name || ''
        }
      } catch {
        // TMDB 出错只影响这一条：按片名 + 年份去重
      }
    }
    const lookup: LibraryLookup | null = await findLibraryItems(
      'tmdb',
      title.title,
      6
    ).catch(() => null)
    const item = lookup ? findInLibrary(title, lookup.items) : null
    if (item) found.set(title.doubanId, item)
  })

  return splitByLibrary(titles, title => found.get(title.doubanId) ?? null)
}
