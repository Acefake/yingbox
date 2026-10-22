/**
 * 媒体库页面打开 / 关闭视频墙：点工具栏「视频墙」时按选中项或当前筛选结果取影片（wall-pool.ts），
 * 取到才挂上 VideoWall；关闭即卸载（释放全部视频）。
 */
import { type ShallowRef, shallowRef } from 'vue'

import type {
  LibraryItemSummary,
  LibraryQuery,
} from '../../../../../shared/library/ipc'
import { toast } from '@/components/ui/toast'

import { errorText, libraryBridge } from '../api/bridge'
import type { PagedList } from '../wall/paged-list'
import { wallPool } from './wall-pool'

/** 视频墙入口的状态与操作。 */
export interface WallEntry {
  /** 视频墙要放的影片；空数组表示没打开 */
  items: ShallowRef<LibraryItemSummary[]>
  open(): Promise<void>
  close(): void
}

/** 视频墙入口。 */
export function useWallEntry(input: {
  selection: { readonly value: ReadonlySet<number> }
  list: PagedList
  query: () => LibraryQuery
}): WallEntry {
  const items = shallowRef<LibraryItemSummary[]>([])

  async function open(): Promise<void> {
    const bridge = libraryBridge()
    if (!bridge) return
    try {
      items.value = await wallPool({
        selection: input.selection.value,
        list: input.list,
        query: input.query(),
        fetch: q => bridge.query(q),
      })
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return {
    items,
    open,
    close: () => {
      items.value = []
    },
  }
}
