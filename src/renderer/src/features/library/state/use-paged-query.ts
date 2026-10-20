/**
 * 把 PagedList 接到 Vue：查询条件变化时换代重载，引擎的 items-changed 事件按批合并后局部更新。
 *
 * 列表本身不进响应式系统（5 万条对象不做深层代理），只有一个 version 计数，
 * 读 list 的模板 / computed 依赖 version 即可。
 */
import {
  type ComputedRef,
  type Ref,
  computed,
  onScopeDispose,
  shallowRef,
  watch,
} from 'vue'

import type {
  ItemsChangedEvent,
  LibraryQuery,
} from '../../../../../shared/library/ipc'
import { errorText, libraryBridge } from '../api/bridge'
import { type PageFetcher, PagedList } from '../wall/paged-list'
import { onLibraryEvent } from './library-events'

/** 同一批事件合并的时间窗口。识别时引擎每 250ms 推一次，这里跟上同一节奏。 */
const EVENT_BATCH_MS = 250

/** 合并后的一批变化。 */
export interface ChangeBatch {
  updated: Set<number>
  /** 有增删或 reset：位置会变，需要重载可见区间。 */
  structural: boolean
}

/**
 * 一批变化能否只重载包含这些条目的页：只有“纯更新”且排序不受内容影响
 * （按添加时间、没有状态筛选和搜索）时位置不变；否则重载可见区间。
 */
export function canPatchInPlace(
  query: LibraryQuery,
  batch: ChangeBatch
): boolean {
  if (batch.structural) return false
  const sort = query.sort ?? 'title'
  return sort === 'addedAt' && !query.matchStates && !query.search
}

/** usePagedQuery 的返回值。 */
export interface PagedQuery {
  list: PagedList
  /** 列表内容版本：每次有页到达都会加一。 */
  version: Ref<number>
  total: ComputedRef<number>
  ready: ComputedRef<boolean>
  error: ComputedRef<string | null>
  /** 告诉列表当前可见区间 [start, end)，按需加载。 */
  setVisible: (start: number, end: number) => void
  /** 立即重载可见区间（操作后主动刷新）。 */
  refresh: () => Promise<void>
}

/**
 * 分页查询。
 * @param query 查询条件（响应式 getter，变化即换代重载）
 * @param accepts 判断某个 items-changed 事件是否与本列表有关（按媒体库过滤）
 */
export function usePagedQuery(
  query: () => LibraryQuery,
  accepts: (event: ItemsChangedEvent) => boolean,
  pageSize = 200
): PagedQuery {
  const bridge = libraryBridge()
  const version = shallowRef(0)
  let visible = { start: 0, end: pageSize }

  const fetcherFor =
    (q: LibraryQuery): PageFetcher =>
    (offset, limit) =>
      bridge
        ? bridge.query({ ...q, offset, limit })
        : Promise.resolve({ items: [], total: 0, offset, limit })

  let current = query()
  const list = new PagedList(
    fetcherFor(current),
    () => {
      version.value++
    },
    pageSize
  )

  watch(
    () => JSON.stringify(query()),
    () => {
      current = query()
      list.reset(fetcherFor(current))
      void list.ensure(visible.start, visible.end)
    }
  )

  let pending: ChangeBatch | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  function flush(): void {
    timer = undefined
    const batch = pending
    pending = null
    if (!batch) return
    if (canPatchInPlace(current, batch)) {
      list.refreshIds(batch.updated)
    } else {
      void list.invalidate(visible.start, visible.end)
    }
  }

  onLibraryEvent(event => {
    if (event.type !== 'items-changed' || !accepts(event)) return
    pending ??= { updated: new Set(), structural: false }
    if (event.reset || event.added.length || event.removed.length) {
      pending.structural = true
    }
    for (const id of event.updated) pending.updated.add(id)
    timer ??= setTimeout(flush, EVENT_BATCH_MS)
  })

  onScopeDispose(() => clearTimeout(timer))

  /** 读 list 的派生值：依赖 version，列表变化时重新计算。 */
  function tracked<T>(read: () => T): ComputedRef<T> {
    return computed(() => {
      void version.value
      return read()
    })
  }

  void list.ensure(0, pageSize)

  return {
    list,
    version,
    total: tracked(() => list.total),
    ready: tracked(() => list.ready),
    error: tracked(() => (list.error ? errorText(list.error) : null)),
    setVisible(start, end) {
      visible = { start, end }
      void list.ensure(start, end)
    },
    refresh: () => list.invalidate(visible.start, visible.end),
  }
}
