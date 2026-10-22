/**
 * 视频墙放哪些影片：有选中项就只放选中的，否则放当前筛选结果（排序、搜索、筛选与海报墙一致）的前 WALL_POOL_LIMIT 部。
 */
import type {
  LibraryItemSummary,
  LibraryQuery,
  LibraryQueryResult,
} from '../../../../../shared/library/ipc'
import type { PagedList } from '../wall/paged-list'

/** 一面墙最多轮播这么多部（一轮 9 格 × 6 秒，200 部约两个多小时才轮完） */
export const WALL_POOL_LIMIT = 200

/** wallPool 的输入。 */
export interface WallPoolInput {
  /** 海报墙选中的条目 id */
  selection: ReadonlySet<number>
  /** 海报墙已加载的列表（选中项从这里取摘要） */
  list: Pick<PagedList, 'at' | 'indexOfId'>
  /** 海报墙当前的查询条件 */
  query: LibraryQuery
  /** 查询一页 */
  fetch: (query: LibraryQuery) => Promise<LibraryQueryResult>
}

/** 取视频墙要放的影片（按显示顺序）。 */
export async function wallPool(
  input: WallPoolInput
): Promise<LibraryItemSummary[]> {
  if (input.selection.size)
    return [...input.selection]
      .map(id => input.list.indexOfId(id))
      .filter(index => index >= 0)
      .map(index => input.list.at(index))
      .filter((item): item is LibraryItemSummary => Boolean(item))
  const page = await input.fetch({
    ...input.query,
    offset: 0,
    limit: WALL_POOL_LIMIT,
  })
  return page.items
}
