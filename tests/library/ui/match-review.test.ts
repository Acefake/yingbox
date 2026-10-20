import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import type {
  ApplyMatchResult,
  LibraryItemNode,
  MatchCandidateInfo,
} from '../../../src/shared/library/ipc'
import {
  type ReviewBridge,
  localFileNames,
  parseManualMatch,
  useMatchReview,
} from '../../../src/renderer/src/features/library/review/use-match-review'

describe('parseManualMatch', () => {
  it('数字、tmdb 前缀和 TMDB 链接 → tmdbId', () => {
    expect(parseManualMatch('157336')).toEqual({ tmdbId: '157336' })
    expect(parseManualMatch('tmdb:157336')).toEqual({ tmdbId: '157336' })
    expect(parseManualMatch('TMDB 157336')).toEqual({ tmdbId: '157336' })
    expect(
      parseManualMatch('https://www.themoviedb.org/movie/157336-interstellar')
    ).toEqual({ tmdbId: '157336' })
    expect(parseManualMatch('https://www.themoviedb.org/tv/1396')).toEqual({
      tmdbId: '1396',
    })
  })

  it('IMDb 编号和链接 → imdbId（小写）', () => {
    expect(parseManualMatch('tt0816692')).toEqual({ imdbId: 'tt0816692' })
    expect(parseManualMatch('https://www.imdb.com/title/TT0816692/')).toEqual({
      imdbId: 'tt0816692',
    })
  })

  it('片名，末尾年份单独取出', () => {
    expect(parseManualMatch('星际穿越 2014')).toEqual({
      query: { title: '星际穿越', year: 2014 },
    })
    expect(parseManualMatch('Heat (1995)')).toEqual({
      query: { title: 'Heat', year: 1995 },
    })
    expect(parseManualMatch('Blade Runner 2049')).toEqual({
      query: { title: 'Blade Runner', year: 2049 },
    })
    expect(parseManualMatch('  千与千寻 ')).toEqual({
      query: { title: '千与千寻' },
    })
  })

  it('片名本身是数字时，加上年份即可按片名搜', () => {
    expect(parseManualMatch('1917 2019')).toEqual({
      query: { title: '1917', year: 2019 },
    })
  })

  it('空输入返回 null', () => {
    expect(parseManualMatch('   ')).toBeNull()
  })
})

function node(partial: Partial<LibraryItemNode> = {}): LibraryItemNode {
  return {
    id: 7,
    libraryId: 1,
    type: 'movie',
    title: 'Interstellar',
    originalTitle: null,
    year: 2014,
    matchState: 'review',
    providerIds: {},
    poster: null,
    backdrop: null,
    rating: null,
    addedAt: 0,
    updatedAt: 0,
    seasonNumber: null,
    episodeNumber: null,
    overview: null,
    logo: null,
    runtime: null,
    genres: [],
    airDate: null,
    metadata: null,
    files: [
      {
        id: 1,
        path: '/media/Interstellar.2014.1080p.mkv',
        kind: 'video',
        size: 1,
        mtime: 0,
      },
      {
        id: 2,
        path: '/media/Interstellar.nfo',
        kind: 'nfo',
        size: 1,
        mtime: 0,
      },
    ],
    children: [],
    ...partial,
  }
}

function candidate(id: string, title: string): MatchCandidateInfo {
  return {
    provider: 'tmdb',
    kind: 'movie',
    id,
    title,
    originalTitle: null,
    year: 2014,
    confidence: 0.7,
    breakdown: {},
    poster: null,
    overview: null,
  }
}

function fakeBridge(applyResult: ApplyMatchResult) {
  const bridge = {
    getItem: vi.fn(async () => node()),
    getMatchCandidates: vi.fn(async () => ({
      itemId: 7,
      matchState: 'review' as const,
      current: null,
      candidates: [candidate('157336', '星际穿越'), candidate('1', '别的')],
    })),
    applyMatch: vi.fn(async () => applyResult),
    lockMatch: vi.fn(async () => node({ matchState: 'locked' }).valueOf()),
    unlockMatch: vi.fn(async () => node().valueOf()),
    refreshMetadata: vi.fn(async () => ({ jobId: 1 })),
  }
  return bridge as typeof bridge & ReviewBridge
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await nextTick()
}

describe('useMatchReview', () => {
  it('载入本地文件与候选；采用候选 = 指定 tmdbId 并锁定', async () => {
    const bridge = fakeBridge({ status: 'matched', item: null, candidates: [] })
    const scope = effectScope()
    const review = scope.run(() => useMatchReview(ref(7), bridge))!
    await flush()
    expect(review.node.value?.title).toBe('Interstellar')
    expect(review.candidates.value?.candidates).toHaveLength(2)
    expect(localFileNames(review.node.value)).toEqual([
      'Interstellar.2014.1080p.mkv',
    ])

    const outcome = await review.adopt(review.candidates.value!.candidates[0])
    expect(outcome).toEqual({ kind: 'matched' })
    expect(bridge.applyMatch).toHaveBeenCalledWith({
      itemId: 7,
      tmdbId: '157336',
      lock: true,
    })
    // 匹配后重新读取条目
    expect(bridge.getItem).toHaveBeenCalledTimes(2)
    expect(review.busy.value).toBeNull()
    scope.stop()
  })

  it('手动搜索不够自信时，返回的候选替代原候选显示', async () => {
    const results = [candidate('9', '搜索结果')]
    const bridge = fakeBridge({
      status: 'review',
      item: null,
      candidates: results,
    })
    const scope = effectScope()
    const review = scope.run(() => useMatchReview(ref(7), bridge))!
    await flush()
    const outcome = await review.search('星际穿越 2014')
    expect(bridge.applyMatch).toHaveBeenCalledWith({
      itemId: 7,
      query: { title: '星际穿越', year: 2014 },
      lock: true,
    })
    expect(outcome).toEqual({ kind: 'candidates', count: 1 })
    expect(review.searchResults.value).toEqual(results)
    scope.stop()
  })

  it('锁定 / 解锁后重新读取；切换条目清掉搜索结果', async () => {
    const bridge = fakeBridge({
      status: 'unmatched',
      item: null,
      candidates: [],
    })
    const id = ref<number | null>(7)
    const scope = effectScope()
    const review = scope.run(() => useMatchReview(id, bridge))!
    await flush()
    await review.search('nothing')
    expect(review.searchResults.value).toEqual([])
    await review.setLocked(true)
    expect(bridge.lockMatch).toHaveBeenCalledWith(7)
    id.value = 8
    await flush()
    expect(bridge.getItem).toHaveBeenLastCalledWith(8)
    expect(review.searchResults.value).toBeNull()
    scope.stop()
  })

  it('引擎报错：错误码前缀去掉，返回 error，busy 复位', async () => {
    const bridge = fakeBridge({ status: 'matched', item: null, candidates: [] })
    bridge.applyMatch.mockRejectedValueOnce(
      new Error('[library:invalid-params] tmdbId 必须是数字')
    )
    const scope = effectScope()
    const review = scope.run(() => useMatchReview(ref(7), bridge))!
    await flush()
    const outcome = await review.adopt(candidate('x', '坏的'))
    expect(outcome).toEqual({ kind: 'error', message: 'tmdbId 必须是数字' })
    expect(review.error.value).toBe('tmdbId 必须是数字')
    expect(review.busy.value).toBeNull()
    scope.stop()
  })
})
