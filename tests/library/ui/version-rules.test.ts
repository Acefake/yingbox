/**
 * 详情的版本选择：默认播放最好的版本，可切换；剧集按来源优先；版本 / 来源的展示文字。
 */
import { describe, expect, it, vi } from 'vitest'

import type {
  LibraryItemFile,
  LibraryItemNode,
  LibraryVersion,
} from '../../../src/shared/library/ipc'
import {
  episodePlayRequest,
  moviePlayRequest,
  videoFileEntries,
} from '../../../src/renderer/src/features/library/detail/playback'
import {
  pickVersion,
  showVersions,
  sourceKey,
  sourceSummaries,
  versionLabel,
} from '../../../src/renderer/src/features/library/detail/version-rules'

vi.mock('../../../src/renderer/src/features/player', () => ({
  openMediaPlayer: vi.fn(),
}))

const file = (id: number, path: string, size = 1): LibraryItemFile => ({
  id,
  path,
  kind: 'video',
  size,
  mtime: 0,
})

const version = (
  fileIds: number[],
  partial: Partial<LibraryVersion> = {}
): LibraryVersion => ({
  key: `f${fileIds[0]}`,
  fileIds,
  height: null,
  range: null,
  size: 1,
  folder: '/x',
  itemId: 1,
  libraryId: 1,
  ...partial,
})

const node = (partial: Partial<LibraryItemNode>): LibraryItemNode =>
  ({
    id: 1,
    type: 'movie',
    title: 'Heat',
    files: [],
    children: [],
    genres: [],
    libraryId: 1,
    ...partial,
  }) as LibraryItemNode

describe('电影版本', () => {
  const movie = node({
    files: [
      file(1, '/a/Heat.1080p.mkv'),
      file(2, '/b/Heat.CD1.2160p.mkv'),
      file(3, '/b/Heat.CD2.2160p.mkv'),
    ],
    versions: [
      version([2, 3], { height: 2160, range: 'dv', size: 2 * 1024 ** 3 }),
      version([1], { height: 1080, itemId: 7 }),
    ],
  })

  it('默认播放最好的版本，不把别的版本接着连播；分段按顺序连播', () => {
    const request = moviePlayRequest(movie)!
    expect(request.fileIds).toEqual([2, 3])
    expect(videoFileEntries(movie).map(f => f.id)).toEqual([2, 3])
  })

  it('切换到另一个版本；选择失效（版本没了）时退回默认', () => {
    expect(moviePlayRequest(movie, 'f1')!.fileIds).toEqual([1])
    expect(moviePlayRequest(movie, sourceKey(7))!.fileIds).toEqual([1])
    expect(moviePlayRequest(movie, 'f999')!.fileIds).toEqual([2, 3])
  })

  it('没有版本信息（旧数据形状）时仍按路径播放全部视频文件', () => {
    const plain = node({ files: [file(2, '/b.mkv'), file(1, '/a.mkv')] })
    expect(pickVersion(plain)).toBeUndefined()
    expect(moviePlayRequest(plain)!.fileIds).toEqual([1, 2])
  })

  it('版本规格文字', () => {
    expect(versionLabel(movie.versions![0])).toBe('2160p · DV · 2 段 · 2.00 GB')
    expect(versionLabel(version([1], { size: 0 }))).toBe('0 B')
  })

  it('什么时候显示版本区块', () => {
    expect(showVersions(movie)).toBe(true)
    expect(showVersions(node({ versions: [version([1])] }))).toBe(false)
    expect(showVersions(node({ merge: { members: [], splitFrom: 2 } }))).toBe(
      true
    )
    expect(showVersions(null)).toBe(false)
  })
})

describe('剧集来源', () => {
  const ep = (
    id: number,
    e: number,
    versions: LibraryVersion[]
  ): LibraryItemNode =>
    node({
      id,
      type: 'episode',
      seasonNumber: 1,
      episodeNumber: e,
      files: versions.flatMap(v => v.fileIds.map(f => file(f, `/${f}.mkv`))),
      versions,
    })
  const season = node({
    id: 2,
    type: 'season',
    seasonNumber: 1,
    children: [
      ep(3, 1, [version([31], { itemId: 1, height: 1080 })]),
      ep(4, 2, [
        version([42], { itemId: 9, height: 2160, size: 5 }),
        version([41], { itemId: 1, height: 1080, size: 3 }),
      ]),
    ],
  })
  const series = node({
    id: 1,
    type: 'series',
    children: [season],
    merge: {
      members: [
        { itemId: 1, libraryId: 1, folder: '/a/Show' },
        { itemId: 9, libraryId: 2, folder: '/b/Show' },
      ],
      splitFrom: 0,
    },
  })

  it('默认每集最好的版本；选了来源后每集优先用它，那里没有的集退回最好的', () => {
    const auto = episodePlayRequest(series, season, season.children[0])!
    expect(auto.fileIds).toEqual([31, 42])
    const fromA = episodePlayRequest(
      series,
      season,
      season.children[0],
      sourceKey(1)
    )!
    expect(fromA.fileIds).toEqual([31, 41])
    const fromB = episodePlayRequest(
      series,
      season,
      season.children[1],
      sourceKey(9)
    )!
    expect(fromB.fileIds).toEqual([31, 42])
  })

  it('来源汇总：集数、最高分辨率、总大小', () => {
    expect(
      sourceSummaries(series).map(s => [s.member.itemId, s.label])
    ).toEqual([
      [1, '2 集 · 最高 1080p · 4 B'],
      [9, '1 集 · 最高 2160p · 5 B'],
    ])
    expect(sourceSummaries(node({ type: 'series' }))).toEqual([])
  })
})
