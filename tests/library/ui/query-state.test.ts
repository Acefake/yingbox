import { describe, expect, it } from 'vitest'

import { normalizeLibraryQuery } from '../../../src/shared/library/ipc'
import type { MatchState } from '../../../src/shared/library/ipc/contract'
import {
  defaultOrder,
  defaultWallQuery,
  loadSavedSort,
  reviewQuery,
  saveSort,
  toLibraryQuery,
} from '../../../src/renderer/src/features/library/state/query-state'
import { canPatchInPlace } from '../../../src/renderer/src/features/library/state/use-paged-query'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
    clear: () => map.clear(),
    key: i => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

describe('toLibraryQuery', () => {
  it('电影库只查电影，剧集库只查剧集', () => {
    expect(toLibraryQuery('movie', defaultWallQuery()).types).toEqual(['movie'])
    expect(toLibraryQuery('tv', defaultWallQuery()).types).toEqual(['series'])
  })

  it('按分区限定来源：电影页只查 tmdb 库，番号页只查 jav 库', () => {
    const base = defaultWallQuery()
    expect(toLibraryQuery('movie', base)).toMatchObject({
      types: ['movie'],
      source: 'tmdb',
    })
    expect(toLibraryQuery('jav', base)).toMatchObject({
      types: ['movie'],
      source: 'jav',
    })
    expect(toLibraryQuery('tv', base).source).toBe('tmdb')
    expect(reviewQuery('movie').source).toBe('tmdb')
    expect(reviewQuery('jav').source).toBe('jav')
    // 引擎校验认这个参数
    expect(normalizeLibraryQuery(toLibraryQuery('jav', base)).source).toBe(
      'jav'
    )
  })

  it('默认按添加时间倒序，没有多余条件', () => {
    expect(toLibraryQuery('movie', defaultWallQuery())).toEqual({
      types: ['movie'],
      source: 'tmdb',
      category: 'plain',
      sort: 'addedAt',
      order: 'desc',
    })
  })

  it('筛选映射到匹配状态，已匹配 = 自动 + 锁定', () => {
    const q = (
      filter: ReturnType<typeof defaultWallQuery>['filter']
    ): MatchState[] | undefined =>
      toLibraryQuery('movie', { ...defaultWallQuery(), filter }).matchStates
    expect(q('all')).toBeUndefined()
    expect(q('matched')).toEqual(['auto', 'locked'])
    expect(q('review')).toEqual(['review'])
    expect(q('unmatched')).toEqual(['unmatched'])
    expect(q('locked')).toEqual(['locked'])
  })

  it('搜索去空白，空搜索不下发；媒体库筛选可选', () => {
    const base = defaultWallQuery()
    expect(toLibraryQuery('movie', { ...base, search: '   ' }).search).toBe(
      undefined
    )
    const q = toLibraryQuery('movie', {
      ...base,
      search: ' 星际 ',
      libraryId: 3,
    })
    expect(q.search).toBe('星际')
    expect(q.libraryId).toBe(3)
  })

  it('评分排序能通过引擎的参数校验', () => {
    const q = toLibraryQuery('movie', {
      ...defaultWallQuery(),
      sort: 'rating',
      order: defaultOrder('rating'),
    })
    expect(normalizeLibraryQuery(q)).toMatchObject({
      sort: 'rating',
      order: 'desc',
    })
  })

  it('待确认队列：待确认与未匹配，按片名', () => {
    expect(reviewQuery('tv')).toEqual({
      types: ['series'],
      source: 'tmdb',
      category: 'plain',
      matchStates: ['review', 'unmatched'],
      sort: 'title',
      order: 'asc',
    })
  })
})

describe('排序记忆', () => {
  it('每个分区各记一份，非法值忽略', () => {
    const storage = memoryStorage()
    expect(loadSavedSort('movie', storage)).toBeNull()
    saveSort('movie', { sort: 'year', order: 'asc' }, storage)
    expect(loadSavedSort('movie', storage)).toEqual({
      sort: 'year',
      order: 'asc',
    })
    expect(loadSavedSort('tv', storage)).toBeNull()
    expect(loadSavedSort('jav', storage)).toBeNull()
    storage.setItem('library.wall.tv', '{"sort":"bogus"}')
    expect(loadSavedSort('tv', storage)).toBeNull()
    storage.setItem('library.wall.tv', 'not json')
    expect(loadSavedSort('tv', storage)).toBeNull()
  })
})

describe('canPatchInPlace（diff 事件局部更新）', () => {
  const updated = new Set([1, 2])

  it('纯更新 + 按添加时间 + 无筛选搜索：只重载所在页', () => {
    expect(
      canPatchInPlace({ sort: 'addedAt' }, { updated, structural: false })
    ).toBe(true)
  })

  it('有增删、或排序 / 筛选会受内容影响：重载可见区间', () => {
    expect(
      canPatchInPlace({ sort: 'addedAt' }, { updated, structural: true })
    ).toBe(false)
    expect(
      canPatchInPlace({ sort: 'title' }, { updated, structural: false })
    ).toBe(false)
    expect(
      canPatchInPlace(
        { sort: 'addedAt', matchStates: ['review'] },
        { updated, structural: false }
      )
    ).toBe(false)
    expect(
      canPatchInPlace(
        { sort: 'addedAt', search: 'x' },
        { updated, structural: false }
      )
    ).toBe(false)
  })
})

describe('分面筛选', () => {
  it('番号页选了条件才带 facets（普通对象，可跨进程传）；其它分区忽略', async () => {
    const {
      toLibraryQuery: q,
      defaultWallQuery: d,
      facetScopeOf,
    } = await import('../../../src/renderer/src/features/library/state/query-state')
    expect(q('jav', d()).facets).toBeUndefined()
    const facets = { kind: ['fc2' as const], tag: ['巨乳'] }
    expect(q('jav', { ...d(), facets }).facets).toEqual(facets)
    expect(q('jav', { ...d(), facets }).facets).not.toBe(facets)
    expect(q('movie', { ...d(), facets }).facets).toBeUndefined()
    expect(facetScopeOf('jav', { libraryId: 3 })).toEqual({
      source: 'jav',
      libraryId: 3,
    })
    expect(facetScopeOf('movie', { libraryId: null })).toBeUndefined()
  })
})

describe('浏览胶囊与类型（电影 / 剧集）', () => {
  it('类型映射到 facets.tag，未看 = watched:false，最近添加 = addedFrom；番号页忽略', async () => {
    const {
      toLibraryQuery: q,
      defaultWallQuery: d,
      recentFrom,
      RECENT_DAYS,
    } = await import('../../../src/renderer/src/features/library/state/query-state')
    expect(d()).toMatchObject({ browse: 'all', genre: null })
    expect(q('movie', { ...d(), genre: '科幻' }).facets).toEqual({
      tag: ['科幻'],
    })
    expect(q('tv', { ...d(), browse: 'unwatched' }).watched).toBe(false)
    const now = new Date(2026, 9, 27, 15, 30).getTime()
    const from = q('movie', { ...d(), browse: 'recent' }, now).addedFrom
    expect(from).toBe(recentFrom(now))
    expect(from).toBe(new Date(2026, 9, 27 - RECENT_DAYS).getTime())
    const jav = q('jav', { ...d(), genre: '科幻', browse: 'unwatched' })
    expect(jav.facets).toBeUndefined()
    expect(jav.watched).toBeUndefined()
    // 引擎校验认这些参数
    expect(
      normalizeLibraryQuery(
        q('movie', { ...d(), genre: '科幻', browse: 'recent' }, now)
      )
    ).toMatchObject({ facets: { tag: ['科幻'] }, addedFrom: from })
  })

  it('类型计数范围：与海报墙同一顶层类型 / 来源 / 媒体库；番号页没有', async () => {
    const {
      genreScopeOf,
      filterKeyOf,
      defaultWallQuery: d,
    } = await import('../../../src/renderer/src/features/library/state/query-state')
    expect(genreScopeOf('movie', { libraryId: null })).toEqual({
      field: 'tag',
      types: ['movie'],
      source: 'tmdb',
      category: 'plain',
    })
    expect(genreScopeOf('tv', { libraryId: 2 })).toEqual({
      field: 'tag',
      types: ['series'],
      source: 'tmdb',
      category: 'plain',
      libraryId: 2,
    })
    // 动漫等页面：电影和剧集都要，只算这一类
    expect(genreScopeOf('anime', { libraryId: null })).toEqual({
      field: 'tag',
      types: ['movie', 'series'],
      source: 'tmdb',
      category: 'anime',
    })
    expect(genreScopeOf('jav', { libraryId: null })).toBeUndefined()
    // 换类型 / 浏览胶囊算换筛选（清空多选、回到顶部）
    expect(filterKeyOf({ ...d(), genre: '科幻' })).not.toEqual(filterKeyOf(d()))
    expect(filterKeyOf({ ...d(), browse: 'recent' })).not.toEqual(
      filterKeyOf(d())
    )
  })

  it('选了类型或观看筛选时不能局部更新', () => {
    const updated = new Set([1])
    expect(
      canPatchInPlace(
        { sort: 'addedAt', facets: { tag: ['科幻'] } },
        { updated, structural: false }
      )
    ).toBe(false)
    expect(
      canPatchInPlace(
        { sort: 'addedAt', watched: false },
        { updated, structural: false }
      )
    ).toBe(false)
    expect(
      canPatchInPlace(
        { sort: 'addedAt', addedFrom: 1 },
        { updated, structural: false }
      )
    ).toBe(true)
  })
})
