import { describe, expect, it } from 'vitest'

import {
  highlightMeta,
  highlightSpecs,
  runtimeLabel,
  videoNamesOf,
} from '../src/renderer/src/features/library/home/highlight-rules'
import type {
  LibraryFileKind,
  LibraryItemFile,
  LibraryItemNode,
} from '../src/shared/library/ipc'

/** 首页 Hero 的片库条目信息：规格标签、元信息行、视频文件名。 */

const node = (over: Partial<LibraryItemNode>): LibraryItemNode =>
  ({
    id: 1,
    libraryId: 1,
    type: 'movie',
    title: '沙丘：第二部',
    originalTitle: null,
    year: 2024,
    matchState: 'matched',
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
    runtime: 166,
    genres: ['科幻', '冒险', '剧情'],
    airDate: null,
    metadata: null,
    files: [],
    children: [],
    ...over,
  }) as LibraryItemNode

describe('Hero 规格标签', () => {
  it('按分级 → 4K → 杜比视界 → 全景声 → 中字排', () => {
    expect(
      highlightSpecs({
        certification: '13+',
        videoRange: 'dv',
        fileNames: ['D:\\Movies\\Dune.Part.Two.2024.2160p.DV.Atmos.中字.mkv'],
      })
    ).toEqual([
      { variant: 'rating', text: '13+' },
      { variant: 'solid', text: '4K' },
      { variant: 'dolby', text: 'VISION' },
      { variant: 'dolby', text: 'ATMOS' },
      { variant: 'outline', text: '中字' },
    ])
  })

  it('长分级用描边方块；没有线索时不出标签；目录名里的 4K 不算', () => {
    expect(highlightSpecs({ certification: 'PG-13', fileNames: [] })).toEqual([
      { variant: 'outline', text: 'PG-13' },
    ])
    expect(
      highlightSpecs({
        videoRange: 'sdr',
        fileNames: ['/media/4K/movie.1080p.mkv'],
      })
    ).toEqual([])
    expect(
      highlightSpecs({ videoRange: 'hdr10', fileNames: ['/m/a.UHD.chs.mkv'] })
    ).toEqual([
      { variant: 'solid', text: '4K' },
      { variant: 'solid', text: 'HDR10' },
      { variant: 'outline', text: '中字' },
    ])
  })
})

describe('Hero 元信息行', () => {
  it('时长', () => {
    expect(runtimeLabel(166)).toBe('2 小时 46 分')
    expect(runtimeLabel(120)).toBe('2 小时')
    expect(runtimeLabel(45)).toBe('45 分钟')
    expect(runtimeLabel(null)).toBe('')
  })

  it('电影：年份 · 前两个类型 · 时长；剧集写季数', () => {
    expect(highlightMeta(node({}))).toEqual([
      '2024 年',
      '科幻、冒险',
      '2 小时 46 分',
    ])
    const season = node({ type: 'season', children: [] })
    expect(
      highlightMeta(
        node({
          type: 'series',
          year: null,
          genres: [],
          children: [season, season],
        })
      )
    ).toEqual(['2 季'])
  })

  it('视频文件逐季逐集收集，有上限', () => {
    const file = (
      path: string,
      kind: LibraryFileKind = 'video'
    ): LibraryItemFile => ({
      id: 1,
      path,
      kind,
      size: 0,
      mtime: 0,
    })
    const episode = (path: string): LibraryItemNode =>
      node({ type: 'episode', files: [file(path)] })
    const series = node({
      type: 'series',
      files: [file('/tv/poster.jpg', 'image')],
      children: [
        node({
          type: 'season',
          children: [episode('/tv/e1.mkv'), episode('/tv/e2.mkv')],
        }),
      ],
    })
    expect(videoNamesOf(series)).toEqual(['/tv/e1.mkv', '/tv/e2.mkv'])
    expect(videoNamesOf(series, 1)).toEqual(['/tv/e1.mkv'])
  })
})
