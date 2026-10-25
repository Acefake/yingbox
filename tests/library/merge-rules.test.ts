/**
 * 合并展示的纯规则：版本分组与排序、分辨率 / 动态范围读法、来源文件夹、树合并。
 */
import { describe, expect, it } from 'vitest'
import { mergeTrees } from '../../src/main/library/catalog/merge/merge-tree'
import {
  type VersionFileMeta,
  buildVersions,
  commonFolder,
  ownerFolder,
  rangeOf,
  resolutionOf,
} from '../../src/main/library/catalog/merge/version-rules'
import type {
  LibraryItemFile,
  LibraryItemNode,
} from '../../src/shared/library/ipc'

const file = (
  id: number,
  path: string,
  size = 1,
  extra: Partial<LibraryItemFile> = {}
): LibraryItemFile => ({ id, path, kind: 'video', size, mtime: 0, ...extra })

const meta = (
  entries: Array<[number, Partial<VersionFileMeta>]>
): Map<number, VersionFileMeta> =>
  new Map(
    entries.map(([id, m]) => [
      id,
      { part: null, itemId: 1, libraryId: 1, ...m },
    ])
  )

function node(partial: Partial<LibraryItemNode>): LibraryItemNode {
  return {
    id: 1,
    libraryId: 1,
    type: 'movie',
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
    ...partial,
  }
}

describe('resolutionOf / rangeOf', () => {
  it('文件名里的分辨率写法；文件名没有时看所在文件夹', () => {
    expect(resolutionOf('/m/Heat.1995.2160p.UHD.mkv')).toBe(2160)
    expect(resolutionOf('/m/Heat.1995.1080i.mkv')).toBe(1080)
    expect(resolutionOf('/m/Heat [3840x2160].mkv')).toBe(2160)
    expect(resolutionOf('/m/Heat.4K.HDR.mkv')).toBe(2160)
    expect(resolutionOf('D:\\Heat.1995.720p.WEB-DL\\heat.mkv')).toBe(720)
    expect(resolutionOf('/m/Heat (1995)/Heat.mkv')).toBeNull()
    // 片名里的数字不是分辨率
    expect(resolutionOf('/m/2160 Days/2160.Days.mkv')).toBeNull()
  })

  it('动态范围：探测结果优先，否则看文件名；HDRip 不是 HDR', () => {
    expect(
      rangeOf(
        file(1, '/m/a.HDR.mkv', 1, {
          video: { range: 'sdr', dvProfile: null, dvCompat: null },
        })
      )
    ).toBe('sdr')
    expect(rangeOf(file(1, '/m/a.2160p.DV.HDR.mkv'))).toBe('dv')
    expect(rangeOf(file(1, '/m/a.HDR10+.mkv'))).toBe('hdr10')
    expect(rangeOf(file(1, '/m/a.HDRip.mkv'))).toBeNull()
    expect(rangeOf(file(1, '/m/a.DVDRip.mkv'))).toBeNull()
  })
})

describe('buildVersions', () => {
  it('分辨率 > 动态范围 > 体积；默认版本在最前', () => {
    const versions = buildVersions(
      [
        file(1, '/a/Heat.1080p.mkv', 30),
        file(2, '/b/Heat.2160p.mkv', 10),
        file(3, '/c/Heat.2160p.DV.mkv', 5),
        file(4, '/d/Heat.1080p.mkv', 40),
      ],
      meta([
        [1, {}],
        [2, {}],
        [3, {}],
        [4, {}],
      ])
    )
    expect(versions.map(v => v.fileIds[0])).toEqual([3, 2, 4, 1])
    expect(versions[0]).toMatchObject({
      key: 'f3',
      height: 2160,
      range: 'dv',
      size: 5,
      folder: '/c',
    })
  })

  it('同一文件夹的分段合成一个版本、按分段号播放；不同文件夹或没有分段号的各自成版本', () => {
    const versions = buildVersions(
      [
        file(11, '/a/Heat.CD2.mkv', 2),
        file(10, '/a/Heat.CD1.mkv', 3),
        file(20, '/b/Heat.mkv', 4),
        file(21, '/b/Heat.Remux.mkv', 1),
        { ...file(30, '/a/Heat.nfo'), kind: 'nfo' },
      ],
      meta([
        [10, { part: 1 }],
        [11, { part: 2 }],
        [20, { itemId: 2 }],
        [21, { itemId: 2 }],
        [30, {}],
      ])
    )
    expect(versions.map(v => v.fileIds)).toEqual([[10, 11], [20], [21]])
    expect(versions[0].size).toBe(5)
    expect(versions[1].itemId).toBe(2)
  })

  it('查不到元信息的文件不进版本', () => {
    expect(buildVersions([file(1, '/a/x.mkv')], new Map())).toEqual([])
  })
})

describe('来源文件夹', () => {
  it('公共文件夹按路径段比较，保留原分隔符', () => {
    expect(
      commonFolder([
        'D:\\TV\\Show\\Season 1\\e1.mkv',
        'D:\\TV\\Show\\Season 2\\e1.mkv',
      ])
    ).toBe('D:\\TV\\Show')
    expect(commonFolder(['/tv/Show/S1/a.mkv', '/tv/Shows/S1/a.mkv'])).toBe(
      '/tv'
    )
    expect(commonFolder([])).toBe('')
  })

  it('去掉末尾的季文件夹', () => {
    expect(ownerFolder('/tv/Show/Season 1')).toBe('/tv/Show')
    expect(ownerFolder('D:\\TV\\人生切割术\\第一季')).toBe('D:\\TV\\人生切割术')
    expect(ownerFolder('/movies/Heat (1995)')).toBe('/movies/Heat (1995)')
  })
})

describe('mergeTrees', () => {
  const ep = (
    id: number,
    s: number | null,
    e: number,
    fileId: number
  ): LibraryItemNode =>
    node({
      id,
      type: 'episode',
      seasonNumber: s,
      episodeNumber: e,
      files: [file(fileId, `/x/${fileId}.mkv`)],
    })
  const season = (
    id: number,
    n: number,
    children: LibraryItemNode[]
  ): LibraryItemNode => node({ id, type: 'season', seasonNumber: n, children })

  it('季按季号、集按集号对齐；某处独有的季 / 集接进来；不改输入', () => {
    const a = node({
      id: 1,
      type: 'series',
      title: 'A',
      children: [season(2, 1, [ep(3, 1, 1, 101), ep(4, 1, 2, 102)])],
    })
    const b = node({
      id: 10,
      type: 'series',
      title: 'B',
      children: [
        season(11, 1, [ep(12, 1, 2, 201), ep(13, 1, 3, 202)]),
        season(14, 2, [ep(15, 2, 1, 203)]),
      ],
    })
    const merged = mergeTrees(a, [b])
    expect(merged.title).toBe('A')
    expect(merged.children.map(s => [s.id, s.seasonNumber])).toEqual([
      [2, 1],
      [14, 2],
    ])
    expect(
      merged.children[0].children.map(e => [e.id, e.files.map(f => f.id)])
    ).toEqual([
      [3, [101]],
      [4, [102, 201]],
      [13, [202]],
    ])
    expect(a.children[0].children).toHaveLength(2)
    expect(a.children[0].children[1].files).toHaveLength(1)
  })

  it('绝对集数挂在剧下也能对齐；有元数据的那份当展示节点', () => {
    const a = node({ id: 1, type: 'series', children: [ep(2, null, 5, 101)] })
    const rich = {
      ...ep(20, null, 5, 201),
      title: '第五集',
      metadata: { level: 'episode' } as LibraryItemNode['metadata'],
    }
    const b = node({ id: 10, type: 'series', children: [rich] })
    const [only] = mergeTrees(a, [b]).children
    expect(only).toMatchObject({ id: 20, title: '第五集' })
    expect(only.files.map(f => f.id)).toEqual([101, 201])
  })

  it('电影：文件并在一起', () => {
    const merged = mergeTrees(node({ files: [file(1, '/a/x.mkv')] }), [
      node({ id: 2, files: [file(2, '/b/x.mkv')] }),
    ])
    expect(merged.files.map(f => f.id)).toEqual([1, 2])
  })
})
