/**
 * 自然语言搜索的「按片名判断」兜底：触发条件、候选与模型输出清洗、条件 → 查询的替换，
 * 以及 useNlSearch 里的调用流程（AI 与引擎查询用 mock：私密分区、缓存、失败保留类型筛选）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'

import type {
  LibraryItemSummary,
  LibraryQuery,
  LibraryQueryResult,
} from '../src/shared/library/ipc'
import { applyNlFilter } from '../src/renderer/src/features/library/nl-search/nl-rules'
import {
  TITLE_PICK_LIMIT,
  looseFilter,
  needsTitlePick,
  resolveTitlePick,
  sanitizePickedIds,
  titleCandidates,
  titlePickApplies,
  titlePickMessages,
  titlePickScope,
} from '../src/renderer/src/features/library/nl-search/nl-title-pick'

import type { NlSearch } from '../src/renderer/src/features/library/nl-search/use-nl-search'

const summary = (
  id: number,
  title: string,
  year: number | null = null,
  originalTitle: string | null = null
): LibraryItemSummary => ({
  id,
  libraryId: 1,
  type: 'movie',
  title,
  originalTitle,
  year,
  matchState: 'unmatched',
  providerIds: {},
  poster: null,
  backdrop: null,
  rating: null,
  addedAt: 0,
  updatedAt: 0,
})

const page = (
  total: number,
  items: LibraryItemSummary[] = []
): LibraryQueryResult => ({ items, total, offset: 0, limit: 1 })

describe('按片名判断：规则', () => {
  it('类型筛选为 0 条、或本分区有类型的不到 30% 时兜底；空分区不兜底', () => {
    expect(needsTitlePick({ matched: 0, total: 10, withGenres: 10 })).toBe(true)
    expect(needsTitlePick({ matched: 3, total: 10, withGenres: 2 })).toBe(true)
    expect(needsTitlePick({ matched: 3, total: 10, withGenres: 3 })).toBe(false)
    expect(needsTitlePick({ matched: 0, total: 0, withGenres: 0 })).toBe(false)
  })

  it('候选只留片名、不同的原名和年份，最多 300 条；模型输出只认候选里的 id', () => {
    const items = Array.from({ length: TITLE_PICK_LIMIT + 5 }, (_, i) =>
      summary(i + 1, `片${i + 1}`)
    )
    items[0] = summary(1, '盗梦空间', 2010, 'Inception')
    items[1] = summary(2, 'Heat', null, 'Heat')
    const list = titleCandidates(items)
    expect(list).toHaveLength(TITLE_PICK_LIMIT)
    expect(list[0]).toEqual({ id: 1, t: '盗梦空间', o: 'Inception', y: 2010 })
    expect(list[1]).toEqual({ id: 2, t: 'Heat' })
    expect(sanitizePickedIds({ ids: [2, '1', 2, 999, 'x'] }, list)).toEqual([
      2, 1,
    ])
    expect(sanitizePickedIds('oops', list)).toEqual([])
    const [system, user] = titlePickMessages(
      '90 年代的科幻片',
      list.slice(0, 1)
    )
    expect(system.content).toContain('片名')
    expect(user.content).toContain('90 年代的科幻片')
    expect(user.content).toContain('"t":"盗梦空间"')
  })

  it('结果只在类型、地区集合与查询范围都一致时生效；替换类型 / 地区条件，与看过的 id 取交集', () => {
    const base: LibraryQuery = { types: ['movie'] }
    const pick = {
      genres: ['科幻', '动作'],
      countries: ['US'],
      scope: titlePickScope(base),
      ids: [3, 5, 7],
    }
    const filter = {
      genres: ['动作', '科幻'],
      countries: ['US'],
      yearFrom: 1990,
    }
    expect(titlePickApplies(pick, filter, base)).toBe(true)
    // 排序 / 分页 / 片名搜索不算范围变化
    const paged = { ...base, sort: 'title', offset: 60, limit: 60 } as const
    expect(titlePickApplies(pick, filter, paged)).toBe(true)
    expect(titlePickApplies(pick, { genres: ['科幻'] }, base)).toBe(false)
    // 地区变了、或换了媒体库：不再适用
    expect(titlePickApplies(pick, { ...filter, countries: ['JP'] }, base)).toBe(
      false
    )
    expect(titlePickApplies(pick, { ...filter, countries: [] }, base)).toBe(
      false
    )
    expect(titlePickApplies(pick, filter, { ...base, libraryId: 2 })).toBe(
      false
    )
    expect(titlePickApplies(null, filter, base)).toBe(false)
    expect(looseFilter(filter)).toEqual({ yearFrom: 1990 })

    const ctx = {
      section: 'movie' as const,
      genres: ['科幻'],
      watchedIds: [5, 9],
    }
    expect(applyNlFilter(base, filter, { ...ctx, titlePick: pick })).toEqual({
      types: ['movie'],
      yearFrom: 1990,
      ids: [3, 5, 7],
    })
    expect(
      applyNlFilter(
        base,
        { ...filter, watched: true },
        { ...ctx, titlePick: pick }
      ).ids
    ).toEqual([5])
    // 删掉一个类型后不再适用：回到普通的类型 / 地区筛选
    expect(
      applyNlFilter(base, { genres: ['科幻'] }, { ...ctx, titlePick: pick })
    ).toEqual({ types: ['movie'], facets: { tag: ['科幻'] } })
  })
})

describe('resolveTitlePick', () => {
  const queries = {
    strict: { types: ['movie'], facets: { tag: ['科幻'] } },
    section: { types: ['movie'] },
    loose: { types: ['movie'], yearFrom: 1990 },
  } satisfies Record<string, LibraryQuery>

  it('类型够用时只数一下，不调模型', async () => {
    const chat = vi.fn()
    const query = vi.fn(async (q: LibraryQuery) =>
      page(q.facets ? 4 : q.hasGenres ? 8 : 10)
    )
    const pick = await resolveTitlePick(
      '科幻片',
      { genres: ['科幻'] },
      queries,
      { query, chat }
    )
    expect(pick).toBeNull()
    expect(chat).not.toHaveBeenCalled()
    expect(query.mock.calls.every(([q]) => q.limit === 1)).toBe(true)
  })

  it('类型信息不全：按其余条件取候选交给模型，返回挑中的 id', async () => {
    const items = [summary(1, '星际穿越', 2014), summary(2, '让子弹飞', 2010)]
    const query = vi.fn(async (q: LibraryQuery) =>
      q.limit === 1 ? page(q.facets ? 0 : q.hasGenres ? 1 : 10) : page(2, items)
    )
    const chat = vi.fn(async () => ({ ids: [1, 42] }))
    const pick = await resolveTitlePick(
      '科幻片',
      { genres: ['科幻'] },
      queries,
      { query, chat }
    )
    expect(pick).toEqual({
      genres: ['科幻'],
      countries: [],
      scope: titlePickScope(queries.section),
      ids: [1],
    })
    const last = query.mock.calls.at(-1)![0]
    expect(last).toMatchObject({ yearFrom: 1990, limit: TITLE_PICK_LIMIT })
    expect(last).not.toHaveProperty('facets')
  })

  it('类型筛选本来有结果、模型一部没挑：不兜底（保留类型筛选，不变成 0 条）', async () => {
    const query = vi.fn(async (q: LibraryQuery) =>
      q.limit === 1
        ? page(q.facets ? 2 : q.hasGenres ? 1 : 10)
        : page(1, [summary(1, 'A')])
    )
    const chat = vi.fn(async () => ({ ids: [] }))
    const filter = { genres: ['科幻'] }
    expect(
      await resolveTitlePick('科幻片', filter, queries, { query, chat })
    ).toBeNull()
    // 类型筛选本来就是 0 条时，空结果照常生效（结果同样是 0 条，但带上说明）
    const none = vi.fn(async (q: LibraryQuery) =>
      q.limit === 1 ? page(q.facets ? 0 : 10) : page(1, [summary(1, 'A')])
    )
    const pick = await resolveTitlePick('科幻片', filter, queries, {
      query: none,
      chat,
    })
    expect(pick?.ids).toEqual([])
  })
})

// —— useNlSearch：AI 与引擎查询用 mock ——
const route = reactive({ query: {} as Record<string, string> })
const mocks = vi.hoisted(() => ({
  chatJson: vi.fn(),
  query: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('@/features/ai', async () => {
  const { aiConfigured } = await import('../src/renderer/src/features/ai/ready')
  class AiCallError extends Error {}
  return {
    AiCallError,
    aiAvailable: () => true,
    aiConfigured,
    aiKeyConfigured: () => true,
    chatJson: mocks.chatJson,
  }
})
vi.mock('@/features/player', () => ({ continueRecords: () => ref([]) }))
vi.mock('@/features/settings', () => ({
  useSetting: (key: string) => ref(key === 'ai.provider' ? 'deepseek' : ''),
}))
vi.mock('../src/renderer/src/features/library/api/bridge', () => ({
  libraryBridge: () => ({
    facets: { list: async () => [] },
    query: mocks.query,
  }),
}))

describe('useNlSearch 按片名判断', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.chatJson.mockReset()
    mocks.query.mockReset()
    route.query = {}
  })
  afterEach(() => vi.useRealTimers())

  async function mount(
    section: 'movie' | 'jav',
    base: () => LibraryQuery = () => ({ types: ['movie'] })
  ): Promise<{ nl: NlSearch; stop: () => void }> {
    const { useNlSearch } =
      await import('../src/renderer/src/features/library/nl-search/use-nl-search')
    const scope = effectScope()
    const nl = scope.run(() => useNlSearch(section, base))!
    return { nl, stop: () => scope.stop() }
  }

  it('类型筛选为 0：第二次请求按片名挑，查询换成 id；私密分区两次都带 private', async () => {
    mocks.query.mockImplementation(async (q: LibraryQuery) =>
      q.limit === 1
        ? page(q.facets ? 0 : q.hasGenres ? 0 : 2)
        : page(2, [
            summary(11, '星际穿越', 2014),
            summary(12, '让子弹飞', 2010),
          ])
    )
    mocks.chatJson
      .mockResolvedValueOnce({ data: { genres: ['科幻'] } })
      .mockResolvedValueOnce({ data: { ids: [11] } })
    const { nl, stop } = await mount('jav')
    route.query = { q: '?科幻片' }
    await vi.advanceTimersByTimeAsync(700)
    await nextTick()
    expect(nl.status.value).toBe('done')
    expect(nl.query()).toEqual({ types: ['movie'], ids: [11] })
    expect(nl.message.value).toContain('按片名判断')
    const [first, second] = mocks.chatJson.mock.calls.map(c => c[0])
    expect(first.private).toBe(true)
    expect(second.private).toBe(true)
    expect(second.schemaName).toBe('library_title_pick')
    // 传给引擎的是普通对象
    expect(mocks.query.mock.calls.every(([q]) => !('__v_raw' in q))).toBe(true)
    stop()
  })

  it('按片名判断失败：保留类型筛选并提示', async () => {
    mocks.query.mockImplementation(async (q: LibraryQuery) =>
      q.limit === 1 ? page(q.facets ? 0 : 3) : page(1, [summary(1, 'A')])
    )
    mocks.chatJson
      .mockResolvedValueOnce({ data: { genres: ['悬疑'] } })
      .mockRejectedValueOnce(new Error('boom'))
    const { nl, stop } = await mount('movie')
    route.query = { q: '?悬疑片' }
    await vi.advanceTimersByTimeAsync(700)
    await nextTick()
    expect(nl.status.value).toBe('done')
    expect(nl.query()).toEqual({ types: ['movie'], facets: { tag: ['悬疑'] } })
    expect(nl.message.value).toContain('按片名判断失败')
    stop()
  })

  it('切换媒体库：按片名判断按新范围重新做，不复用旧的 id 集合', async () => {
    mocks.query.mockImplementation(async (q: LibraryQuery) => {
      if (q.limit === 1) return page(q.facets ? 0 : q.hasGenres ? 0 : 2)
      return q.libraryId === 2
        ? page(1, [summary(21, '银翼杀手', 1982)])
        : page(1, [summary(11, '星际穿越', 2014)])
    })
    mocks.chatJson
      .mockResolvedValueOnce({ data: { genres: ['奇幻'] } })
      .mockResolvedValueOnce({ data: { ids: [11] } })
      .mockResolvedValueOnce({ data: { ids: [21] } })
    const libraryId = ref(1)
    const { nl, stop } = await mount('movie', () => ({
      types: ['movie'],
      libraryId: libraryId.value,
    }))
    route.query = { q: '?奇幻片' }
    await vi.advanceTimersByTimeAsync(700)
    await nextTick()
    expect(nl.query().ids).toEqual([11])
    libraryId.value = 2
    await nextTick()
    // 新范围的结果出来前不沿用旧 id，回到类型筛选
    expect(nl.query().ids).toBeUndefined()
    await vi.advanceTimersByTimeAsync(10)
    await nextTick()
    expect(nl.query()).toEqual({
      types: ['movie'],
      libraryId: 2,
      ids: [21],
    })
    expect(mocks.chatJson).toHaveBeenCalledTimes(3)
    stop()
  })
})
