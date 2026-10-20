import { describe, expect, it } from 'vitest'
import {
  hasAbsolute,
  mapEpisodes,
  summarizeEpisodes,
} from '../../../src/main/library/identify/episode-mapping'
import type { ChildItem } from '../../../src/main/library/identify/identify-store'
import { mergeIdentifyPayload } from '../../../src/main/library/identify/identify-module'
import { refFromOsResponse } from '../../../src/main/library/providers/opensubtitles/os-hash-lookup'
import { LibraryError, parseRpcParams } from '../../../src/shared/library/ipc'

const ep = (
  id: number,
  season: number | null,
  episode: number | null
): ChildItem => ({
  id,
  type: 'episode',
  parentId: 0,
  season,
  episode,
  localKey: `e${id}`,
})

describe('剧集集映射', () => {
  it('季集直接对应；绝对集数按顺序表；没有集号的不映射', () => {
    const children = [
      ep(1, 1, 3),
      ep(2, null, 2),
      ep(3, null, null),
      ep(4, null, 99),
    ]
    expect(hasAbsolute(children)).toBe(true)
    const order = [
      { season: 1, episode: 1 },
      { season: 0, episode: 1 },
    ]
    expect(mapEpisodes(children, order)).toEqual([
      { itemId: 1, position: { season: 1, episode: 3 }, mapped: false },
      { itemId: 2, position: { season: 0, episode: 1 }, mapped: true },
    ])
  })

  it('整部剧摘要：取正片集数最多的一季；全是绝对集数时标记 absolute', () => {
    expect(
      summarizeEpisodes([ep(1, 0, 1), ep(2, 1, 1), ep(3, 2, 5), ep(4, 2, 3)])
    ).toEqual({ season: 2, episodes: [3, 5] })
    expect(summarizeEpisodes([ep(1, null, 30), ep(2, null, 14)])).toEqual({
      episodes: [14, 30],
      absolute: true,
    })
    expect(summarizeEpisodes([])).toBeUndefined()
  })
})

describe('识别任务载荷合并', () => {
  it('任一方整库就是整库，否则条目取并集', () => {
    expect(
      mergeIdentifyPayload(
        { mode: 'identify', itemIds: [1, 2] },
        { mode: 'identify', itemIds: [2, 3] }
      )
    ).toEqual({ mode: 'identify', libraryId: undefined, itemIds: [1, 2, 3] })
    expect(
      mergeIdentifyPayload(
        { mode: 'identify', libraryId: 1, itemIds: [1] },
        { mode: 'identify', libraryId: 1 }
      )
    ).toEqual({ mode: 'identify', libraryId: 1 })
  })
})

describe('OpenSubtitles 哈希反查', () => {
  it('只认 moviehash_match 的结果；剧集取所属剧的 TMDB id', () => {
    expect(
      refFromOsResponse({
        data: [
          {
            attributes: {
              moviehash_match: false,
              feature_details: { feature_type: 'Movie', tmdb_id: 1 },
            },
          },
          {
            attributes: {
              moviehash_match: true,
              feature_details: {
                feature_type: 'Episode',
                tmdb_id: 9,
                parent_tmdb_id: 1396,
              },
            },
          },
        ],
      })
    ).toEqual({ provider: 'tmdb', kind: 'tv', id: '1396' })
    expect(refFromOsResponse({ data: [] })).toBeNull()
    expect(refFromOsResponse(null)).toBeNull()
  })
})

describe('识别相关 IPC 参数', () => {
  const bad = (
    method: Parameters<typeof parseRpcParams>[0],
    params: unknown
  ): string => {
    try {
      parseRpcParams(method, params)
    } catch (error) {
      return (error as LibraryError).code
    }
    return 'ok'
  }

  it('identify / refreshMetadata 至少给 libraryId 或 itemIds', () => {
    expect(
      parseRpcParams('identify', { itemIds: [3, 3, 4], force: 1 })
    ).toEqual({
      libraryId: undefined,
      itemIds: [3, 4],
      force: true,
    })
    expect(bad('identify', {})).toBe('invalid-params')
    expect(bad('refreshMetadata', { itemIds: [0] })).toBe('invalid-params')
  })

  it('applyMatch：tmdbId / imdbId / tvdbId / query 恰好一个，格式校验，默认锁定', () => {
    expect(
      parseRpcParams('applyMatch', { itemId: 1, tmdbId: '603' })
    ).toMatchObject({ tmdbId: '603', lock: true })
    expect(
      parseRpcParams('applyMatch', {
        itemId: 1,
        imdbId: 'TT0133093',
        lock: false,
      })
    ).toMatchObject({
      imdbId: 'tt0133093',
      lock: false,
    })
    expect(
      parseRpcParams('applyMatch', {
        itemId: 1,
        query: { title: ' 让子弹飞 ', year: 2010 },
      })
    ).toMatchObject({
      query: { title: '让子弹飞', year: 2010 },
    })
    expect(bad('applyMatch', { itemId: 1 })).toBe('invalid-params')
    expect(
      bad('applyMatch', { itemId: 1, tmdbId: '603', imdbId: 'tt0133093' })
    ).toBe('invalid-params')
    expect(bad('applyMatch', { itemId: 1, tmdbId: 'abc' })).toBe(
      'invalid-params'
    )
    expect(bad('applyMatch', { itemId: 1, query: { title: '' } })).toBe(
      'invalid-params'
    )
  })

  it('setProviderToken：空串视为清除，拒绝含空白的令牌', () => {
    expect(
      parseRpcParams('setProviderToken', { provider: 'tmdb', token: '  ' })
    ).toEqual({
      provider: 'tmdb',
      token: null,
    })
    expect(bad('setProviderToken', { provider: 'tmdb', token: 'a b' })).toBe(
      'invalid-params'
    )
    expect(bad('setProviderToken', { provider: 'imdb', token: 'x' })).toBe(
      'invalid-params'
    )
  })
})
