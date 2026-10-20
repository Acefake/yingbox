import { describe, expect, it, vi } from 'vitest'

import type {
  LibraryItemSummary,
  LibraryQueryResult,
} from '../../../src/shared/library/ipc'
import { PagedList } from '../../../src/renderer/src/features/library/wall/paged-list'

function summary(id: number, title = `片${id}`): LibraryItemSummary {
  return {
    id,
    libraryId: 1,
    type: 'movie',
    title,
    originalTitle: null,
    year: 2000,
    matchState: 'auto',
    providerIds: {},
    poster: null,
    backdrop: null,
    rating: null,
    addedAt: id,
    updatedAt: id,
  }
}

/** 假引擎：total 条，id = 下标 + 1；记录每次请求的 offset。 */
function fakeEngine(total: number, titlePrefix = '片') {
  const calls: number[] = []
  let pending: Array<() => void> = []
  let manual = false
  const fetch = vi.fn(
    (offset: number, limit: number): Promise<LibraryQueryResult> => {
      calls.push(offset)
      const result = {
        items: Array.from(
          { length: Math.max(0, Math.min(limit, total - offset)) },
          (_, i) => summary(offset + i + 1, `${titlePrefix}${offset + i + 1}`)
        ),
        total,
        offset,
        limit,
      }
      if (!manual) return Promise.resolve(result)
      return new Promise(resolve => pending.push(() => resolve(result)))
    }
  )
  return {
    fetch,
    calls,
    /** 之后的请求挂起，直到 release()。 */
    hold() {
      manual = true
    },
    release() {
      const run = pending
      pending = []
      manual = false
      run.forEach(fn => fn())
    },
  }
}

describe('PagedList', () => {
  it('按可见区间只请求需要的页', async () => {
    const engine = fakeEngine(50_000)
    const onChange = vi.fn()
    const list = new PagedList(engine.fetch, onChange, 200)
    await list.ensure(0, 60)
    expect(engine.calls).toEqual([0])
    expect(list.total).toBe(50_000)
    expect(list.at(0)?.id).toBe(1)
    expect(list.at(199)?.id).toBe(200)
    expect(list.at(200)).toBeUndefined()

    // 滚到第 25000 条附近：只要那一页
    await list.ensure(25_010, 25_070)
    expect(engine.calls).toEqual([0, 25_000])
    expect(list.at(25_010)?.id).toBe(25_011)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('跨页区间请求两页，已加载的页不重复请求', async () => {
    const engine = fakeEngine(1000)
    const list = new PagedList(engine.fetch, () => {}, 200)
    await list.ensure(0, 10)
    await list.ensure(190, 230)
    await list.ensure(0, 230)
    expect(engine.calls).toEqual([0, 200])
  })

  it('同一页的并发请求合并为一次', async () => {
    const engine = fakeEngine(1000)
    const list = new PagedList(engine.fetch, () => {}, 200)
    await list.ensure(0, 10)
    engine.hold()
    const a = list.ensure(400, 410)
    const b = list.ensure(405, 420)
    engine.release()
    await Promise.all([a, b])
    expect(engine.calls).toEqual([0, 400])
  })

  it('不请求超出总数的页', async () => {
    const engine = fakeEngine(150)
    const list = new PagedList(engine.fetch, () => {}, 100)
    await list.ensure(0, 100)
    await list.ensure(0, 1000)
    expect(engine.calls).toEqual([0, 100])
  })

  it('换查询后，旧查询迟到的响应被丢弃；新数据到达前保留旧数据', async () => {
    const old = fakeEngine(1000, '旧')
    const list = new PagedList(old.fetch, () => {}, 200)
    await list.ensure(0, 10)
    old.hold()
    const stale = list.ensure(400, 410)

    const next = fakeEngine(5, '新')
    next.hold()
    list.reset(next.fetch)
    const fresh = list.ensure(0, 10)
    // 新数据还没到：旧数据仍在，界面不闪白
    expect(list.at(0)?.title).toBe('旧1')

    old.release()
    await stale
    expect(list.at(400)).toBeUndefined()

    next.release()
    await fresh
    expect(list.total).toBe(5)
    expect(list.at(0)?.title).toBe('新1')
    expect(list.at(5)).toBeUndefined()
  })

  it('refreshIds 只重载包含这些条目的页', async () => {
    const engine = fakeEngine(1000)
    const list = new PagedList(engine.fetch, () => {}, 200)
    await list.ensure(0, 10)
    await list.ensure(600, 610)
    engine.calls.length = 0
    expect(list.refreshIds([605, 99_999])).toBe(1)
    await Promise.resolve()
    expect(engine.calls).toEqual([600])
  })

  it('invalidate 作废全部页，只保留并重载可见区间', async () => {
    const engine = fakeEngine(1000)
    const list = new PagedList(engine.fetch, () => {}, 200)
    await list.ensure(0, 10)
    await list.ensure(600, 610)
    engine.calls.length = 0
    engine.hold()
    const done = list.invalidate(600, 610)
    // 可见页的旧数据先留着，其他页清掉
    expect(list.at(600)?.id).toBe(601)
    expect(list.at(0)).toBeUndefined()
    engine.release()
    await done
    expect(engine.calls).toEqual([600])
  })

  it('请求失败时记录错误，并标记为已就绪（界面可显示错误）', async () => {
    const list = new PagedList(
      () => Promise.reject(new Error('[library:internal] 数据库忙')),
      () => {},
      200
    )
    await list.ensure(0, 10)
    expect(list.ready).toBe(true)
    expect(list.error).toContain('数据库忙')
  })

  it('indexOfId 在已加载的条目里查位置', async () => {
    const engine = fakeEngine(1000)
    const list = new PagedList(engine.fetch, () => {}, 200)
    await list.ensure(0, 10)
    expect(list.indexOfId(5)).toBe(4)
    expect(list.indexOfId(999)).toBe(-1)
  })
})
