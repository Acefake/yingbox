import { describe, expect, it } from 'vitest'

import {
  matchMovieFile,
  movieKeywords,
  movieNextTry,
  releaseStart,
} from '../src/main/autograb/movies/movie-rules'
import { parseMovie, parseSearch } from '../src/main/autograb/movies/tmdb'
import { addDays, searchStart } from '../src/main/autograb/schedule-rules'
import {
  pathSegments,
  resolveFolderCid,
  underMount,
} from '../src/main/autograb/upgrade/folder-path'
import {
  lowResHits,
  scanLibraries,
} from '../src/main/autograb/upgrade/library-scan'
import {
  budgetLeft,
  emptyBudget,
} from '../src/main/autograb/upgrade/quality-rules'
import {
  applyScan,
  emptyUpgradeState,
  parseUpgradeState,
} from '../src/main/autograb/upgrade/state'
import type { Pan115DirListing } from '../src/shared/contract/pan115'
import {
  parseReleaseQuality,
  resolutionOf,
} from '../src/shared/release/quality'
import { isBetterVersion, wantsUpgrade } from '../src/shared/release/score'
import type { ShareFileLike } from '../src/main/autograb/match-rules'
import type {
  LibraryItemFile,
  LibraryItemNode,
} from '../src/shared/library/ipc'

const GB = 1024 ** 3
const ctx = { shareTitle: '', folder: '' }
const target = {
  title: '流浪地球2',
  originalTitle: 'The Wandering Earth II',
  year: 2023,
}

describe('分辨率', () => {
  it('认得出常见写法，认不出为 null', () => {
    expect(resolutionOf('流浪地球.2023.2160p.WEB-DL.mkv')).toBe(2160)
    expect(resolutionOf('Movie.4K.HDR.mkv')).toBe(2160)
    expect(resolutionOf('繁花.第05集.1080P.mp4')).toBe(1080)
    expect(resolutionOf('x.1280x720.mkv')).toBe(720)
    expect(resolutionOf('x.480p.avi')).toBe(480)
    expect(resolutionOf('我不是药神.mkv')).toBeNull()
    // 不把数字里的片段当分辨率
    expect(resolutionOf('21080p_trailer')).toBeNull()
  })

  it('只洗认得出且低于目标的；候选要达到目标且比现在高', () => {
    const q = parseReleaseQuality
    expect(wantsUpgrade(q('a.720p.mkv'), 1080)).toBe(true)
    expect(wantsUpgrade(q('a.1080p.mkv'), 1080)).toBe(false)
    expect(wantsUpgrade(q('a.mkv'), 1080)).toBe(false)
    expect(wantsUpgrade(q('a.1080p.mkv'), 2160)).toBe(true)
    expect(isBetterVersion(q('a.720p'), q('b.1080p'), 1080)).toBe(true)
    expect(isBetterVersion(q('a.720p'), q('b.1080p'), 2160)).toBe(false)
    expect(isBetterVersion(q('a.1080p'), q('b.1080p'), 1080)).toBe(false)
    expect(isBetterVersion(q('a.720p'), q('b.mkv'), 1080)).toBe(false)
  })

  it('子限额跨天清零', () => {
    const day1 = new Date(2026, 9, 25, 10).getTime()
    const budget = emptyBudget(day1)
    budget.snaps = 60
    expect(budgetLeft(budget, day1, 60)).toBe(0)
    expect(budgetLeft(budget, day1 + 24 * 3_600_000, 60)).toBe(60)
  })
})

describe('认电影文件', () => {
  const file = (name: string, size = 8 * GB): ShareFileLike => ({
    name,
    size,
    isDir: false,
  })

  it('片名、年份、片源对得上就收，分数含分辨率', () => {
    const m = matchMovieFile(
      file('流浪地球2.2023.2160p.WEB-DL.H265.mkv'),
      target,
      ctx,
      true
    )
    expect(m.ok).toBe(true)
    if (m.ok) {
      expect(m.resolution).toBe(2160)
      expect(m.reasons).toContain('4K')
      expect(m.reasons).toContain('正式片源')
    }
  })

  it('原名也认；年份差太多、剧集、枪版、太小都不要', () => {
    expect(
      matchMovieFile(
        file('The.Wandering.Earth.II.2023.1080p.BluRay.mkv'),
        target,
        ctx,
        true
      ).ok
    ).toBe(true)
    expect(
      matchMovieFile(file('流浪地球2.2019.1080p.WEB-DL.mkv'), target, ctx, true)
    ).toMatchObject({ ok: false })
    expect(
      matchMovieFile(file('流浪地球2.S01E02.1080p.mkv'), target, ctx, true).ok
    ).toBe(false)
    expect(
      matchMovieFile(file('流浪地球2.2023.HDCAM.mkv'), target, ctx, true).ok
    ).toBe(false)
    expect(
      matchMovieFile(
        file('流浪地球2.2023.1080p.mkv', 100 * 1024 ** 2),
        target,
        ctx,
        true
      ).ok
    ).toBe(false)
    expect(
      matchMovieFile(file('满江红.2023.1080p.WEB-DL.mkv'), target, ctx, true).ok
    ).toBe(false)
  })

  it('上线追踪要看得出片源或至少 720p；洗版不要求', () => {
    expect(
      matchMovieFile(file('流浪地球2.2023.mkv'), target, ctx, true).ok
    ).toBe(false)
    expect(
      matchMovieFile(file('流浪地球2.2023.mkv'), target, ctx, false).ok
    ).toBe(true)
  })

  it('关键词：片名 年份、片名、原名 年份', () => {
    expect(movieKeywords(target)).toEqual([
      '流浪地球2 2023',
      '流浪地球2',
      'The Wandering Earth II 2023',
    ])
  })
})

describe('电影什么时候搜', () => {
  const today = '2026-10-25'
  it('数字发行优先，其次实体，都没有且首映已久从今天开始', () => {
    const dates = [
      { type: 3, date: '2026-01-01' },
      { type: 4, date: '2026-03-02' },
      { type: 4, date: '2026-02-20' },
      { type: 5, date: '2026-04-01' },
    ]
    expect(releaseStart(dates, '2026-01-01', today, addDays)).toEqual({
      date: '2026-02-20',
      source: 'digital',
    })
    expect(
      releaseStart(
        dates.filter(d => d.type !== 4),
        null,
        today,
        addDays
      )
    ).toEqual({ date: '2026-04-01', source: 'physical' })
    expect(releaseStart([], '2025-01-01', today, addDays)).toEqual({
      date: today,
      source: 'premiere',
    })
    expect(releaseStart([], '2026-10-01', today, addDays)).toEqual({
      date: null,
      source: null,
    })
  })

  it('每天一次，30 天后放弃', () => {
    const start = searchStart('2026-10-01')
    expect(movieNextTry('2026-10-01', start)).toBe(start + 24 * 3_600_000)
    expect(movieNextTry('2026-10-01', start + 30 * 24 * 3_600_000)).toBeNull()
  })

  it('TMDB 返回逐字段解析', () => {
    const info = parseMovie({
      id: 842675,
      title: '流浪地球2',
      original_title: 'The Wandering Earth II',
      release_date: '2023-01-22',
      poster_path: '/p.jpg',
      release_dates: {
        results: [
          {
            iso_3166_1: 'CN',
            release_dates: [
              { type: 3, release_date: '2023-01-22T00:00:00.000Z' },
            ],
          },
          {
            iso_3166_1: 'US',
            release_dates: [
              { type: 4, release_date: '2023-04-10T00:00:00.000Z' },
              { bad: 1 },
            ],
          },
        ],
      },
    })
    expect(info).toMatchObject({
      tmdbId: 842675,
      year: 2023,
      poster: 'https://image.tmdb.org/t/p/w342/p.jpg',
    })
    expect(info?.releaseDates).toEqual([
      { type: 3, date: '2023-01-22' },
      { type: 4, date: '2023-04-10' },
    ])
    expect(parseMovie({ id: 'x' })).toBeNull()
    expect(
      parseSearch({
        results: [{ id: 1, title: 'A', release_date: '2020-05-01' }, { id: 2 }],
      })
    ).toEqual([{ tmdbId: 1, title: 'A', year: 2020, poster: null }])
  })
})

describe('本地目录 → 115 文件夹', () => {
  const tree: Record<string, { cid: string; name: string }[]> = {
    '0': [
      { cid: '10', name: '影视' },
      { cid: '11', name: '其它' },
    ],
    '10': [{ cid: '20', name: '电影' }],
    '20': [{ cid: '30', name: '流浪地球2 (2023)' }],
  }
  const dirs = async (cid: string): Promise<Pan115DirListing> => ({
    cid,
    path: [],
    dirs: tree[cid] ?? [],
    truncated: false,
  })

  it('路径分段认 / 和 \\、去盘符；挂载根目录下的相对段', () => {
    expect(pathSegments('Z:\\115\\影视\\电影')).toEqual(['115', '影视', '电影'])
    expect(underMount('/mnt/cd2/115/影视/电影', '/mnt/cd2/115')).toEqual([
      '影视',
      '电影',
    ])
    expect(underMount('z:\\115\\影视', 'Z:\\115')).toEqual(['影视'])
    expect(underMount('/other/影视', '/mnt/cd2/115')).toBeNull()
  })

  it('填了挂载根目录按它逐级找；没填就从根目录同名文件夹对齐；对不上为 null', async () => {
    expect(
      await resolveFolderCid(
        '/mnt/115/影视/电影/流浪地球2 (2023)',
        '/mnt/115',
        dirs
      )
    ).toBe('30')
    expect(
      await resolveFolderCid(
        '/Volumes/CloudDrive/115/影视/电影/流浪地球2 (2023)',
        '',
        dirs
      )
    ).toBe('30')
    expect(
      await resolveFolderCid('/mnt/115/影视/剧集', '/mnt/115', dirs)
    ).toBeNull()
    expect(await resolveFolderCid('/data/movies', '', dirs)).toBeNull()
  })
})

function node(partial: Partial<LibraryItemNode>): LibraryItemNode {
  return {
    id: 1,
    libraryId: 1,
    type: 'movie',
    title: 'X',
    originalTitle: null,
    year: 2020,
    matchState: 'auto',
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
    files: [],
    children: [],
    ...partial,
  }
}

const video = (id: number, path: string): LibraryItemFile => ({
  id,
  path,
  kind: 'video' as const,
  size: GB,
  mtime: 0,
})

describe('清点片库', () => {
  it('电影取最好的文件判断；剧集逐集，跳过特别篇', () => {
    const movie = node({
      id: 5,
      files: [video(1, '/m/X.720p.mkv'), video(2, '/m/X.1080p.mkv')],
    })
    expect(lowResHits(movie, 1080)).toEqual([])
    expect(lowResHits(movie, 2160)).toMatchObject([
      { itemId: 5, resolution: 1080, filePath: '/m/X.1080p.mkv' },
    ])
    const series = node({
      id: 9,
      type: 'series',
      title: '繁花',
      children: [
        node({
          id: 90,
          type: 'season',
          seasonNumber: 0,
          children: [
            node({
              id: 91,
              type: 'episode',
              episodeNumber: 1,
              files: [video(3, '/s/sp.480p.mkv')],
            }),
          ],
        }),
        node({
          id: 92,
          type: 'season',
          seasonNumber: 1,
          children: [
            node({
              id: 93,
              type: 'episode',
              episodeNumber: 1,
              files: [video(4, '/s/E01.720p.mkv')],
            }),
            node({
              id: 94,
              type: 'episode',
              episodeNumber: 2,
              files: [video(5, '/s/E02.mkv')],
            }),
          ],
        }),
      ],
    })
    expect(lowResHits(series, 1080)).toEqual([
      {
        itemId: 93,
        kind: 'episode',
        title: '繁花',
        year: 2020,
        season: 1,
        episode: 1,
        filePath: '/s/E01.720p.mkv',
        resolution: 720,
      },
    ])
  })

  it('清点结果并入记录：新的建、没了的删、已有结果的留', () => {
    const state = emptyUpgradeState(0)
    const hit = {
      itemId: 1,
      kind: 'movie' as const,
      title: 'A',
      year: 2020,
      season: null,
      episode: null,
      filePath: '/a.720p.mkv',
      resolution: 720,
    }
    expect(applyScan(state, [hit], 100)).toBe(true)
    expect(state.records['1']).toMatchObject({
      status: 'waiting',
      nextTry: 100,
    })
    expect(applyScan(state, [hit], 200)).toBe(false)
    state.records['2'] = {
      ...state.records['1'],
      key: '2',
      itemId: 2,
      status: 'replaced',
    }
    applyScan(state, [], 300)
    expect(Object.keys(state.records)).toEqual(['2'])
  })

  it('状态文件逐字段校验', () => {
    const parsed = parseUpgradeState(
      {
        version: 1,
        enabled: true,
        target: 2160,
        records: {
          '1': { status: 'bogus', filePath: '/a' },
          '2': {
            status: 'found',
            filePath: '/b',
            candidates: [{ shareUrl: 'u', fileId: 'f' }, {}],
          },
        },
        dirCids: { '/a': '12', '/b': 'x' },
      },
      0
    )
    expect(parsed.target).toBe(2160)
    expect(Object.keys(parsed.records)).toEqual(['2'])
    expect(parsed.records['2'].candidates).toHaveLength(1)
    expect(parsed.dirCids).toEqual({ '/a': '12' })
    expect(parseUpgradeState({ version: 2 }, 0).enabled).toBe(false)
  })
})

describe('洗版清点', () => {
  it('混合库（新加的普通片库都是）电影和剧都查，单一类型的旧库只查自己的', async () => {
    const asked: unknown[] = []
    const lib = (
      id: number,
      kind: 'movie' | 'tv',
      mixed: boolean
    ): unknown => ({
      id,
      kind,
      mixed,
      cloud: true,
      source: 'tmdb',
    })
    const reader = {
      listLibraries: async () =>
        [lib(1, 'movie', true), lib(2, 'tv', false)] as never,
      query: async (q: { types?: string[] }) => {
        asked.push(q.types)
        return { items: [], total: 0, offset: 0, limit: 0 }
      },
      getItem: async () => null,
    }
    const rule = { target: 2160, prefs: {} } as never
    await scanLibraries(reader, { movie: rule, tv: rule })
    expect(asked).toEqual([['movie', 'series'], ['series']])
  })
})
