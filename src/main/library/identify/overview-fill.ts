/**
 * 刮削后的中文简介补全：元数据语言是中文时，本次识别涉及的电影 / 剧集里简介不是中文的
 * （TMDB 没有中文简介，识别时先用了英文占位，见 tmdb-map.ts），按片名 + 年份在豆瓣找到条目，
 * 用条目简介替换；豆瓣也没有就保留英文。
 *
 * - 只碰 TMDB 来源的库，番号 / 私密库不查；只换顶层条目（季 / 集不动）；
 * - 与豆瓣补类型共用同一个低速 HTTP 层、响应缓存与 frodo 回退（genre-fill.ts 组装）：
 *   搜索与补类型是同一个缓存键，补过类型的条目这里不再发搜索请求；单次任务最多发
 *   {@link OVERVIEW_FILL_REQUEST_LIMIT} 个请求，命中缓存的不占名额；
 * - 请求出错（被拦截、验证页、网络失败）就停下并记日志；取消照常抛出。
 */
import { type LibraryDb, StatementCache, transaction } from '../db/database'
import type {
  DoubanGenreLookup,
  DoubanGenreQuery,
} from '../providers/douban/douban-genres'
import type { DoubanIntroLookup } from '../providers/douban/douban-intro'
import { MetadataWriter } from './metadata-writer'

/** 单次任务最多发几个豆瓣请求（搜索 + 详情各算一个）。 */
export const OVERVIEW_FILL_REQUEST_LIMIT = 40
/** 单次任务最多看多少个条目。 */
const SCAN_LIMIT = 500
/** 豆瓣简介记成的语言。 */
const DOUBAN_LANGUAGE = 'zh-CN'

/** 补全需要的能力。 */
export interface OverviewFillDeps {
  db: LibraryDb
  search: Pick<DoubanGenreLookup, 'subject' | 'cached'>
  intro: Pick<DoubanIntroLookup, 'intro' | 'cached'>
  now?: () => number
  log?: (message: string) => void
}

/** 这些顶层条目里，TMDB 库中简介不是中文（或没有简介）的电影 / 剧集。 */
function pendingItems(
  db: LibraryDb,
  itemIds: readonly number[]
): Array<{ id: number; query: DoubanGenreQuery }> {
  if (!itemIds.length) return []
  const rows = new StatementCache(db)
    .get(
      `SELECT i.id, i.type, i.title, i.original_title, i.year
       FROM media_items i JOIN libraries l ON l.id = i.library_id
       WHERE i.id IN (SELECT value FROM json_each(?))
         AND l.source = 'tmdb' AND i.type IN ('movie', 'series')
         AND json_valid(i.metadata)
         AND json_extract(i.metadata, '$.level') = 'title'
         AND COALESCE(json_extract(i.metadata, '$.overviewLanguage'), '')
           NOT LIKE 'zh%'
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
 * 给这些顶层条目补中文简介；返回有改动的条目 id。
 * signal 取消时抛出，其余错误只记日志并停止。
 */
export async function fillOverviewsFromDouban(
  deps: OverviewFillDeps,
  itemIds: readonly number[],
  signal?: AbortSignal
): Promise<number[]> {
  const now = deps.now ?? Date.now
  const writer = new MetadataWriter(deps.db)
  const changed: number[] = []
  let requests = 0
  /** 这次查询要不要占名额；名额用完返回 false（跳过，命中缓存的照常补）。 */
  const budget = (cached: boolean): boolean => {
    if (cached) return true
    if (requests >= OVERVIEW_FILL_REQUEST_LIMIT) return false
    requests++
    return true
  }
  for (const item of pendingItems(deps.db, itemIds)) {
    signal?.throwIfAborted()
    let intro = ''
    try {
      if (!budget(deps.search.cached(item.query))) continue
      const subject = await deps.search.subject(item.query, signal)
      if (!subject || !budget(deps.intro.cached(subject))) continue
      intro = await deps.intro.intro(subject, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      deps.log?.(`豆瓣补简介中止：${(error as Error).message}`)
      break
    }
    if (!intro) continue
    const wrote = transaction(deps.db, () =>
      writer.replaceForeignOverview(item.id, intro, DOUBAN_LANGUAGE, now())
    )
    if (wrote) changed.push(item.id)
  }
  return changed
}
