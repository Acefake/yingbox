/**
 * 渲染层的片库观看进度：上报改缓存并攒批写进片库、写失败留着重写、续播位置，
 * 继续播放记录从片库进度生成（电影 / 剧集 / 看完指向下一集），老版本本地进度搬进片库，
 * 详情页与海报墙的观看标记，以及剧集播完本地最后一集的提示。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  LibraryItemNode,
  ProgressReport,
  RecentProgress,
  WatchProgress,
} from '../src/shared/library/ipc'

const save = vi.fn(async (reports: ProgressReport[]) =>
  reports.map(
    (r): WatchProgress => ({
      itemId: r.itemId,
      fileId: r.fileId ?? null,
      position: r.position,
      duration: r.duration,
      watched: r.ended === true || r.watched === true,
      updatedAt: r.at ?? 0,
    })
  )
)
const list = vi.fn(async (): Promise<WatchProgress[]> => [])
const legacy = new Map<string, unknown>()

vi.mock('../src/renderer/src/features/library/api/bridge', () => ({
  libraryBridge: () => ({ progress: { save, list } }),
  usesLibraryServer: () => false,
}))
vi.mock('../src/renderer/src/features/player', () => ({
  readMediaProgress: (key: string) => legacy.get(key) ?? null,
  mergeContinue: vi.fn(),
}))
vi.mock('../src/renderer/src/features/autograb', () => ({
  autograbAvailable: true,
}))
vi.mock('../src/renderer/src/services/library-server', () => ({
  serverFileUrl: (id: number) => `https://nas/media/files/${id}`,
}))
vi.mock('../src/renderer/src/features/library/api/images', () => ({
  itemImage: (url: string | null) => url,
}))
vi.mock('../src/renderer/src/features/library/state/use-libraries', () => ({
  findLibrary: () => ({ id: 1, kind: 'tv', source: 'tmdb' }),
}))

const cache =
  await import('../src/renderer/src/features/library/progress/progress-cache')
const { continueRecordFrom } =
  await import('../src/renderer/src/features/library/progress/continue-source')
const { itemMark, posterMark } =
  await import('../src/renderer/src/features/library/progress/watch-marks')
const { episodePlayRequest, primaryPlayRequest, seasonEndHint } =
  await import('../src/renderer/src/features/library/detail/playback')

/** 一个节点（只填用得到的字段）。 */
function node(patch: Partial<LibraryItemNode>): LibraryItemNode {
  return {
    id: 0,
    libraryId: 1,
    type: 'episode',
    title: '',
    originalTitle: null,
    year: null,
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
    ...patch,
  } as LibraryItemNode
}

const video = (id: number): LibraryItemNode['files'][number] => ({
  id,
  path: `/tv/${id}.mkv`,
  kind: 'video' as const,
  size: 1,
  mtime: 1,
})
const ep = (
  id: number,
  n: number,
  withFile = true,
  season = 1
): LibraryItemNode =>
  node({
    id,
    title: `E${n}`,
    seasonNumber: season,
    episodeNumber: n,
    files: withFile ? [video(id * 10)] : [],
  })

/** 一部剧：第 1 季 3 集（第 3 集没文件），第 2 季 1 集。 */
function series(): LibraryItemNode {
  const s1 = node({
    id: 2,
    type: 'season',
    seasonNumber: 1,
    children: [ep(11, 1), ep(12, 2), ep(13, 3, false)],
  })
  const s2 = node({
    id: 3,
    type: 'season',
    seasonNumber: 2,
    children: [ep(21, 1, true, 2)],
  })
  return node({ id: 1, type: 'series', title: '剧', children: [s1, s2] })
}

const recent = (patch: Partial<RecentProgress>): RecentProgress => ({
  itemId: 11,
  fileId: 110,
  position: 0,
  duration: 1000,
  watched: false,
  updatedAt: 50,
  rootId: 1,
  libraryId: 1,
  ...patch,
})

beforeEach(() => {
  vi.useFakeTimers()
  cache.resetProgressCache()
  save.mockClear()
  list.mockClear()
  legacy.clear()
})
afterEach(() => vi.useRealTimers())

describe('上报与缓存', () => {
  it('上报立即改缓存，5 秒一批写进片库；看完立即写', async () => {
    cache.reportProgress({ itemId: 11, fileId: 110 }, 120, 1000, false)
    cache.reportProgress({ itemId: 11, fileId: 110 }, 124, 1000, false)
    expect(cache.progressOf(11)).toMatchObject({ position: 124 })
    expect(cache.resumeAt({ itemId: 11, fileId: 110 })).toBe(124)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(cache.FLUSH_DELAY)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toHaveLength(1)

    cache.reportProgress({ itemId: 12, fileId: 120 }, 1000, 1000, true)
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(2)
    // 看完的从头播
    expect(cache.resumeAt({ itemId: 12, fileId: 120 })).toBe(0)
    expect(cache.resumeAt({ itemId: 99, fileId: 1 })).toBeUndefined()
  })

  it('写失败的留着下一批再写', async () => {
    save.mockRejectedValueOnce(new Error('engine-unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    cache.reportProgress({ itemId: 11, fileId: 110 }, 50, 1000, false)
    await cache.flushProgress()
    expect(save).toHaveBeenCalledTimes(1)
    await cache.flushProgress()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0][0]).toMatchObject({ itemId: 11, position: 50 })
    warn.mockRestore()
  })

  it('老版本记在本地的进度：作品第一次读进来时搬进片库，带原来的时间', async () => {
    legacy.set('/tv/110.mkv', {
      progress: 300,
      duration: 1000,
      finished: false,
      updatedAt: 7,
    })
    legacy.set('/tv/120.mkv', {
      progress: 0,
      duration: 1000,
      finished: true,
      updatedAt: 8,
    })
    await cache.prepareProgress(series())
    expect(list).toHaveBeenCalledWith([1])
    expect(save.mock.calls[0][0]).toEqual([
      { itemId: 11, fileId: 110, position: 300, duration: 1000, at: 7 },
      {
        itemId: 12,
        fileId: 120,
        position: 0,
        duration: 1000,
        watched: true,
        at: 8,
      },
    ])
    // 第二次不再搬
    await cache.prepareProgress(series())
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('继续播放记录从片库进度生成', () => {
  it('无季号正片排在特别篇之前', () => {
    const special = node({
      id: 3,
      type: 'season',
      seasonNumber: 0,
      children: [ep(21, 1, true, 0)],
    })
    const show = node({
      id: 1,
      type: 'series',
      title: '节目',
      children: [{ ...ep(11, 1), seasonNumber: null }, special],
    })
    expect(primaryPlayRequest(show)?.refs[0].itemId).toBe(11)
  })
  it('无季号的最后一集看完后不会跳回第一集', () => {
    const show = node({
      id: 1,
      type: 'series',
      title: '节目',
      children: [
        { ...ep(11, 1), seasonNumber: null },
        { ...ep(12, 2), seasonNumber: null },
      ],
    })
    expect(
      continueRecordFrom(
        show,
        recent({ itemId: 12, fileId: 120, position: 1000, watched: true }),
        'tv'
      )
    ).toBeNull()
  })
  it('没看完：从那一集的位置继续；播放列表每项带媒体库标记', () => {
    const record = continueRecordFrom(series(), recent({ position: 400 }), 'tv')
    expect(record).toMatchObject({
      id: 'tv:1',
      progress: 400,
      nextUp: false,
      updatedAt: 50,
      replay: { index: 0, filePath: '/tv/110.mkv' },
    })
    expect(record?.replay.playlist?.[1]).toMatchObject({
      library: { itemId: 12, fileId: 120 },
    })
  })

  it('看完：指向本季下一集；本季播完指向下一季第一集；全看完不列', () => {
    const next = continueRecordFrom(
      series(),
      recent({ position: 950, watched: true }),
      'tv'
    )
    expect(next).toMatchObject({ nextUp: true, progress: 0 })
    expect(next?.replay.playlist?.[next.replay.index ?? 0]).toMatchObject({
      library: { itemId: 12 },
    })
    const season2 = continueRecordFrom(
      series(),
      recent({ itemId: 12, position: 1000, watched: true }),
      'tv'
    )
    expect(season2?.replay.playlist?.[0]).toMatchObject({
      library: { itemId: 21 },
    })
    expect(
      continueRecordFrom(
        series(),
        recent({ itemId: 21, position: 1000, watched: true }),
        'tv'
      )
    ).toBeNull()
  })

  it('电影：没看完接着播，看完不列', () => {
    const movie = node({ id: 5, type: 'movie', files: [video(50)] })
    expect(
      continueRecordFrom(movie, recent({ itemId: 5, rootId: 5, position: 30 }))
    ).toMatchObject({ progress: 30, nextUp: false })
    expect(
      continueRecordFrom(
        movie,
        recent({ itemId: 5, rootId: 5, position: 5, watched: true })
      )
    ).toBeNull()
  })
})

describe('观看标记', () => {
  const p = (patch: Partial<WatchProgress>): WatchProgress => ({
    itemId: 1,
    fileId: null,
    position: 0,
    duration: 1000,
    watched: false,
    updatedAt: 1,
    ...patch,
  })
  it('详情：看到哪儿 + 进度条；看完「已看」；误点不显示', () => {
    expect(itemMark(p({ position: 750 }))).toEqual({
      label: '看到 12:30',
      ratio: 0.75,
      watched: false,
    })
    expect(itemMark(p({ position: 950, watched: true }))).toEqual({
      label: '已看',
      ratio: 0,
      watched: true,
    })
    expect(itemMark(p({ position: 3 }))).toBeNull()
    expect(itemMark(null)).toBeNull()
  })

  it('海报墙：看完角标、看了一部分进度条', () => {
    expect(
      posterMark({ itemId: 1, watched: true, ratio: 1, updatedAt: 1 })
    ).toMatchObject({ label: '已看', watched: true })
    expect(
      posterMark({ itemId: 1, watched: false, ratio: 0.4, updatedAt: 1 })
    ).toMatchObject({ ratio: 0.4, watched: false })
    expect(posterMark(undefined)).toBeNull()
  })
})

describe('剧集播完本地最后一集', () => {
  it('本季后面有没文件的集：点名那一集，并给「去追更」', () => {
    const s = series()
    const season = s.children[0]
    const request = episodePlayRequest(s, season, season.children[0])
    // 第 2 季还有文件：不是整部的结尾，不给提示
    expect(request?.partial).toBe(true)
    expect(request?.endHint).toBeUndefined()
    expect(request?.refs).toEqual([
      { itemId: 11, fileId: 110 },
      { itemId: 12, fileId: 120 },
    ])
    const hint = seasonEndHint(season, season.children.slice(0, 2))
    expect(hint).toEqual({
      text: '本地还没有 S01E03 的文件',
      action: { label: '去追更', to: '/calendar?autograb=1' },
    })
    expect(seasonEndHint(season, season.children).text).toBe(
      '已播完本地的最后一集'
    )
  })
})
