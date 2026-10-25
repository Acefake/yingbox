import { describe, expect, it } from 'vitest'
import type { LibraryItemSummary } from '../../../src/shared/library/ipc'
import {
  fuseSearch,
  routeSearch,
  ruleFilter,
  scopeQuery,
  workKey,
} from '../../../src/renderer/src/features/library/search/search-rules'
import type { RecallBatch } from '../../../src/renderer/src/features/library/search/types'

export const item = (
  id: number,
  overrides: Partial<LibraryItemSummary> = {}
): LibraryItemSummary => ({
  id,
  libraryId: 1,
  type: 'movie',
  title: `影片${id}`,
  originalTitle: null,
  year: 2020,
  matchState: 'locked',
  providerIds: {},
  poster: null,
  backdrop: null,
  rating: null,
  addedAt: 0,
  updatedAt: 0,
  ...overrides,
})
const weights = routeSearch('测试')
describe('统一搜索的路由与排序', () => {
  it('多路有权重，场景描述加强画面召回而不关闭片名', () => {
    const weights = routeSearch('在海边的画面')
    expect(weights.visual).toBeGreaterThan(weights.people)
    expect(weights.title).toBeGreaterThan(0)
  })
  it('规则只提取明确条件，高分只排序，片名不会凭空得到类型条件', () => {
    expect(ruleFilter('90 年代的高分港片')).toMatchObject({
      yearFrom: 1990,
      yearTo: 1999,
      countries: ['HK'],
      sort: { field: 'rating', order: 'desc' },
    })
    expect(ruleFilter('8 分以上的悬疑电影')).toMatchObject({
      ratingMin: 8,
      genres: ['悬疑'],
      type: 'movie',
    })
    expect(ruleFilter('10 分以上的电影').ratingMin).toBe(10)
    expect(ruleFilter('18 分以上的电影').ratingMin).toBeUndefined()
    expect(ruleFilter('喜剧之王')).toEqual({})
    expect(ruleFilter('星际穿越')).toEqual({})
  })
  it('普通查询始终排除私密来源，电影与剧集不串库', () => {
    expect(scopeQuery('all')).toEqual({ source: 'tmdb' })
    expect(scopeQuery('tv')).toEqual({ source: 'tmdb', types: ['series'] })
    expect(scopeQuery('jav')).toEqual({ source: 'jav', types: ['movie'] })
  })
  it('精确片名优先于多路弱命中', () => {
    const batches: RecallBatch[] = [
      {
        kind: 'title',
        candidates: [
          { item: item(1), exact: true, reason: '片名完全匹配' },
          { item: item(2), reason: '片名匹配' },
        ],
      },
      { kind: 'people', candidates: [{ item: item(2), reason: '演员匹配' }] },
      { kind: 'visual', candidates: [{ item: item(2), reason: '画面匹配' }] },
    ]
    const hits = fuseSearch(batches, weights)
    expect(hits[0].item.id).toBe(1)
    expect(hits[1].reasons).toHaveLength(3)
  })
  it('同作品多版本只投一票，保留版本与命中理由；翻拍和同名作品分开', () => {
    const a = item(1, {
      title: '同名',
      providerIds: { tmdb: '10' },
      mergeKey: 'movie:tmdb:10',
    })
    const b = item(2, {
      title: '同名',
      providerIds: { tmdb: '10' },
      mergeKey: 'movie:tmdb:10',
    })
    const hits = fuseSearch(
      [
        {
          kind: 'title',
          candidates: [
            a,
            b,
            item(3, { title: '同名', providerIds: { tmdb: '11' } }),
            item(4, { title: '同名' }),
          ].map(item => ({ item, reason: '片名匹配' })),
        },
      ],
      weights
    )
    expect(hits).toHaveLength(3)
    expect(hits[0].versions).toHaveLength(2)
    expect(hits[0].score).toBeCloseTo(1 / 61)
    expect(workKey({ ...a, type: 'series' })).not.toBe(workKey(a))
    expect(workKey({ ...a, mergeKey: null })).not.toBe(
      workKey({ ...b, mergeKey: null })
    )
  })
})
