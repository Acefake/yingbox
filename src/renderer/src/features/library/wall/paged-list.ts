/**
 * 按需分页加载的稀疏列表（与 Vue 无关的纯逻辑，便于单测）。
 *
 * 海报墙只知道总数和视口区间：滚到哪一页就向引擎要哪一页（默认 200 条），
 * 没加载的位置是 undefined，界面画占位格。变化通过 onChange 通知，由调用方 triggerRef。
 *
 * 一致性靠“代”（generation）：查询条件变了或整体失效时代号加一，旧代的在途响应直接丢弃，
 * 不会把旧查询的结果写进新列表。
 */
import type {
  LibraryItemSummary,
  LibraryQueryResult,
} from '../../../../../shared/library/ipc'

/** 取一页：offset / limit 由列表决定，查询条件由调用方闭包持有。 */
export type PageFetcher = (
  offset: number,
  limit: number
) => Promise<LibraryQueryResult>

/** 稀疏分页列表。 */
export class PagedList {
  /** 满足查询的总条数；第一页返回前为 0。 */
  total = 0
  /** 第一次加载完成前为 false（界面据此区分“加载中”和“空”）。 */
  ready = false
  /** 最近一次加载失败的原因。 */
  error: string | null = null

  private items: Array<LibraryItemSummary | undefined> = []
  private readonly loaded = new Set<number>()
  private readonly inflight = new Map<number, Promise<void>>()
  private generation = 0
  /** reset 后、新一代第一页回来前保留旧数据，避免查询切换时闪白。 */
  private stale = false
  private fetcher: PageFetcher

  constructor(
    fetcher: PageFetcher,
    private readonly onChange: () => void,
    readonly pageSize = 200
  ) {
    this.fetcher = fetcher
  }

  /** 当前长度（= total）。 */
  get length(): number {
    return this.total
  }

  /** 第 index 条；未加载为 undefined。 */
  at(index: number): LibraryItemSummary | undefined {
    return this.items[index]
  }

  /** 已加载的条目里查 id 的下标；没有返回 -1。 */
  indexOfId(id: number): number {
    return this.items.findIndex(item => item?.id === id)
  }

  /** 换查询条件：新一代，旧数据保留到新数据到达。 */
  reset(fetcher?: PageFetcher): void {
    if (fetcher) this.fetcher = fetcher
    this.generation++
    this.loaded.clear()
    this.inflight.clear()
    this.stale = true
  }

  /**
   * 数据变了但查询没变（条目增删、整体 reset 事件）：作废全部页，
   * 保留 [start, end) 的旧数据先显示，再重新加载这一段。
   *
   * 旧的 total 已不可信：从空库加进第一批条目时 total 还是 0，ensure 会以“超出总数”为由一页都不取。
   * 所以可见区间的第一页无条件重载，拿到新总数后再按它补齐其余页。
   */
  invalidate(start: number, end: number): Promise<void> {
    this.generation++
    this.loaded.clear()
    this.inflight.clear()
    const keepFrom = this.pageOf(start) * this.pageSize
    const keepTo = (this.pageOf(Math.max(start, end - 1)) + 1) * this.pageSize
    for (let i = 0; i < this.items.length; i++) {
      if (i < keepFrom || i >= keepTo) this.items[i] = undefined
    }
    const generation = this.generation
    return this.loadPage(this.pageOf(Math.max(0, start)), generation).then(
      () =>
        generation === this.generation ? this.ensure(start, end) : undefined
    )
  }

  /** 只重载包含这些 id 的已加载页（条目内容变化，位置不变）。返回重载的页数。 */
  refreshIds(ids: Iterable<number>): number {
    const wanted = new Set(ids)
    const pages = new Set<number>()
    this.items.forEach((item, index) => {
      if (item && wanted.has(item.id)) pages.add(this.pageOf(index))
    })
    for (const page of pages) {
      this.loaded.delete(page)
      void this.loadPage(page, this.generation)
    }
    return pages.size
  }

  /** 确保 [start, end) 所在的页都已加载或在途。 */
  ensure(start: number, end: number): Promise<void> {
    const generation = this.generation
    const first = this.pageOf(Math.max(0, start))
    // 第一页回来前不知道总数，至少要第 0 页
    const lastIndex = this.ready || !this.stale ? end - 1 : start
    const last = this.pageOf(Math.max(start, lastIndex))
    const pending: Promise<void>[] = []
    for (let page = first; page <= last; page++) {
      if (this.ready && !this.stale && page * this.pageSize >= this.total) {
        break
      }
      pending.push(this.loadPage(page, generation))
    }
    return Promise.all(pending).then(() => undefined)
  }

  private pageOf(index: number): number {
    return Math.floor(index / this.pageSize)
  }

  private loadPage(page: number, generation: number): Promise<void> {
    if (this.loaded.has(page)) return Promise.resolve()
    const existing = this.inflight.get(page)
    if (existing) return existing
    const offset = page * this.pageSize
    const task = this.fetcher(offset, this.pageSize)
      .then(result => {
        if (generation !== this.generation) return
        this.apply(page, result)
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return
        this.error = error instanceof Error ? error.message : String(error)
        this.ready = true
        this.onChange()
      })
      .finally(() => {
        if (this.inflight.get(page) === task) this.inflight.delete(page)
      })
    this.inflight.set(page, task)
    return task
  }

  private apply(page: number, result: LibraryQueryResult): void {
    if (this.stale) {
      this.items = []
      this.stale = false
    }
    this.error = null
    this.ready = true
    if (result.total !== this.total) {
      this.total = result.total
      if (this.items.length > result.total) this.items.length = result.total
    }
    const offset = page * this.pageSize
    result.items.forEach((item, i) => {
      this.items[offset + i] = item
    })
    this.loaded.add(page)
    this.onChange()
  }
}
