/**
 * 刮削后的类型补全：识别任务结束后，本次涉及的电影 / 剧集里仍然没有类型的，按片名 + 年份去豆瓣查
 * 类型与地区补上（只补空字段，见 MetadataWriter.fillLocal）。
 *
 * - 只碰 TMDB 来源的库，番号 / 私密库（source jav）不查；
 * - 低频：豆瓣请求串行、两次之间至少 2 秒（专用的低速 ProviderHttp），单次任务最多发 50 个请求，
 *   命中缓存的不占名额；查询结果（含查无此片）缓存 30 天；
 * - 豆瓣出错（被拦截、验证页、网络失败）就停下，不影响识别任务本身；
 * - 识别模块只在注入了网络实现时启用（桌面端 / 独立服务都会注入；测试缺省不联网）。
 */
import { type LibraryDb, StatementCache, transaction } from '../db/database'
import {
  DoubanGenreLookup,
  type DoubanGenreQuery,
} from '../providers/douban/douban-genres'
import type { ResponseCache } from '../providers/http/provider-cache'
import { type FetchLike, ProviderHttp } from '../providers/http/provider-http'
import { MetadataWriter } from './metadata-writer'

/** 单次任务最多发几个豆瓣请求。 */
export const GENRE_FILL_REQUEST_LIMIT = 50
/** 单次任务最多看多少个没有类型的条目（命中缓存的不发请求）。 */
const SCAN_LIMIT = 500

/** 补全需要的能力。 */
export interface GenreFillDeps {
  db: LibraryDb
  lookup: Pick<DoubanGenreLookup, 'lookup' | 'cached'>
  now?: () => number
  log?: (message: string) => void
}

/** 一个待补的条目。 */
interface Pending {
  id: number
  query: DoubanGenreQuery
}

/** 这些顶层条目里，TMDB 库中仍然没有类型的电影 / 剧集。 */
function pendingItems(db: LibraryDb, itemIds: readonly number[]): Pending[] {
  if (!itemIds.length) return []
  const rows = new StatementCache(db)
    .get(
      `SELECT i.id, i.type, i.title, i.original_title, i.year
       FROM media_items i JOIN libraries l ON l.id = i.library_id
       WHERE i.id IN (SELECT value FROM json_each(?))
         AND l.source = 'tmdb' AND i.type IN ('movie', 'series')
         AND (i.genres IS NULL OR json_array_length(i.genres) = 0)
       ORDER BY i.id LIMIT ?`
    )
    .all(JSON.stringify(itemIds), SCAN_LIMIT)
  return rows
    .filter(r => String(r.title ?? '').trim())
    .map(r => ({
      id: Number(r.id),
      query: {
        title: String(r.title),
        originalTitle:
          r.original_title === null ? null : String(r.original_title),
        year: r.year === null ? null : Number(r.year),
        kind: r.type === 'series' ? 'tv' : 'movie',
      },
    }))
}

/**
 * 给这些顶层条目补类型；返回有改动的条目 id。
 * signal 取消时抛出（与识别任务一致），其余错误只记日志并停止。
 */
export async function fillGenresFromDouban(
  deps: GenreFillDeps,
  itemIds: readonly number[],
  signal?: AbortSignal
): Promise<number[]> {
  const now = deps.now ?? Date.now
  const writer = new MetadataWriter(deps.db)
  const changed: number[] = []
  let requests = 0
  for (const item of pendingItems(deps.db, itemIds)) {
    signal?.throwIfAborted()
    if (!deps.lookup.cached(item.query)) {
      if (requests >= GENRE_FILL_REQUEST_LIMIT) break
      requests++
    }
    let found
    try {
      found = await deps.lookup.lookup(item.query, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      deps.log?.(`豆瓣补类型中止：${(error as Error).message}`)
      break
    }
    if (!found?.genres.length && !found?.countries.length) continue
    const fill = { genres: found.genres, countries: found.countries }
    const wrote = transaction(deps.db, () =>
      writer.fillLocal(item.id, fill, 'douban', now())
    )
    if (wrote) changed.push(item.id)
  }
  return changed
}

/**
 * 组装识别任务用的补全函数：专用低速 HTTP 层（串行、0.5 次 / 秒、不重试），与 TMDB 共用响应缓存。
 */
export function createGenreFill(options: {
  db: LibraryDb
  fetch: FetchLike
  cache: ResponseCache
  log?: (message: string) => void
}): (itemIds: readonly number[], signal?: AbortSignal) => Promise<number[]> {
  const http = new ProviderHttp({
    fetch: options.fetch,
    cache: options.cache,
    rps: 0.5,
    burst: 1,
    concurrency: 1,
    maxRetries: 0,
  })
  const lookup = new DoubanGenreLookup(http, options.cache)
  return (itemIds, signal) =>
    fillGenresFromDouban(
      { db: options.db, lookup, log: options.log },
      itemIds,
      signal
    )
}
