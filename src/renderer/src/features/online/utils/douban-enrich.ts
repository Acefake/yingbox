import { doubanMetadata } from '../api/online'
import type { DoubanItem } from '../types'
import { doubanSubjectId } from './douban-preview'
import { enrichFromTmdb } from './douban-tmdb'

/** 豆瓣列表直接可用；前五项补轮播信息，再按配置用 TMDB 增强。 */
export async function enrichDoubanItems(
  items: DoubanItem[],
  kind: 'movie' | 'tv',
  deps = { metadata: doubanMetadata, tmdb: enrichFromTmdb }
): Promise<void> {
  for (const item of items) {
    item.cover ||= item.coverSrc
    item.type ||= kind === 'tv' ? '剧集' : '电影'
  }
  // 只补首屏候选，其他条目打开详情时再取，避免一页触发几十次请求。
  const candidates = items.slice(0, 5)
  let next = 0
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (next < candidates.length) {
        const item = candidates[next++]
        const id = doubanSubjectId(item.url)
        if (!id) continue
        const detail = await deps
          .metadata(id, item.kind ?? kind)
          .catch(() => null)
        if (!detail) continue
        item.overview = detail.intro || item.overview
        item.original_title = detail.originalTitle || item.original_title
        item.year = detail.year || item.year
        item.backdrop = detail.backdrop || item.backdrop
        item.cover = detail.cover || item.cover
      }
    })
  )
  await deps.tmdb(items, kind)
}
