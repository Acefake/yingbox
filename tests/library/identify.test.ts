import { describe, expect, it } from 'vitest'
import {
  type IdentifyInput,
  type IdentifyResult,
  identify,
  parseNfo,
} from '../../src/shared/library/identify'
import { parseMediaPath } from '../../src/shared/library/parser'
import { type FakeEntry, FakeProvider } from './fake-provider'

const entries: FakeEntry[] = [
  {
    ref: { provider: 'tmdb', kind: 'movie', id: '603' },
    title: 'The Matrix',
    year: 1999,
    popularity: 80,
    externalIds: { imdb: 'tt0133093' },
  },
  {
    ref: { provider: 'tmdb', kind: 'movie', id: '535167' },
    title: 'The Wandering Earth',
    originalTitle: '流浪地球',
    year: 2019,
  },
  {
    ref: { provider: 'tmdb', kind: 'movie', id: '842675' },
    title: 'The Wandering Earth II',
    originalTitle: '流浪地球2',
    year: 2023,
  },
  {
    ref: { provider: 'tmdb', kind: 'tv', id: '1396' },
    title: 'Breaking Bad',
    year: 2008,
    externalIds: { tvdb: '81189' },
    seasons: [{ season: 1, episodeCount: 7 }],
  },
  {
    ref: { provider: 'tmdb', kind: 'movie', id: '1' },
    title: 'Heat',
    year: 1995,
    popularity: 5,
  },
  {
    ref: { provider: 'tmdb', kind: 'movie', id: '2' },
    title: 'Heat',
    year: 1986,
    popularity: 60,
  },
]

const run = (
  path: string,
  extra: Partial<IdentifyInput> = {}
): { provider: FakeProvider; result: Promise<IdentifyResult> } => {
  const provider = new FakeProvider(entries)
  const result = identify(
    { parsed: parseMediaPath(path), ...extra },
    { provider }
  )
  return { provider, result }
}

describe('identify', () => {
  it('锁定优先，不访问元数据源', async () => {
    const locked = { provider: 'tmdb', kind: 'movie', id: '999' } as const
    const { provider, result } = run('/m/The.Matrix.1999.mkv', { locked })
    expect(await result).toEqual({
      status: 'matched',
      source: 'lock',
      ref: locked,
    })
    expect(provider.calls).toEqual([])
  })

  it('NFO 里的 tmdb ID 优先于文件名搜索', async () => {
    const nfo = parseNfo('<movie><uniqueid type="tmdb">603</uniqueid></movie>')
    const { provider, result } = run('/m/whatever.mkv', { nfo })
    expect(await result).toMatchObject({
      status: 'matched',
      source: 'nfo',
      ref: { id: '603' },
    })
    expect(provider.calls).toEqual(['details:movie:603'])
  })

  it('单集 NFO 的 ID 不用于识别整部剧', async () => {
    const nfo = parseNfo(
      '<episodedetails><uniqueid type="tmdb">62085</uniqueid></episodedetails>'
    )
    const { result } = run(
      '/tv/Breaking Bad/Season 1/Breaking.Bad.S01E01.mkv',
      { nfo }
    )
    expect(await result).toMatchObject({
      status: 'matched',
      source: 'search',
      ref: { id: '1396' },
    })
  })

  it('文件名 / 文件夹里的 imdb、tvdb ID 反查，并按类型过滤', async () => {
    expect(
      await run('/m/Some Movie (1999) [imdbid-tt0133093].mkv').result
    ).toMatchObject({
      status: 'matched',
      source: 'filename-id',
      ref: { kind: 'movie', id: '603' },
    })
    expect(
      await run('/tv/Breaking Bad (2008) {tvdb-81189}/Season 1/S01E02.mkv')
        .result
    ).toMatchObject({
      status: 'matched',
      source: 'filename-id',
      ref: { kind: 'tv', id: '1396' },
    })
  })

  it('ID 查不到时继续走搜索', async () => {
    const { result } = run('/m/The Matrix (1999) {tmdb-404}.mkv')
    expect(await result).toMatchObject({
      status: 'matched',
      source: 'search',
      ref: { id: '603' },
    })
  })

  it('哈希查询在 ID 之后、搜索之前', async () => {
    const provider = new FakeProvider(entries)
    const ref = { provider: 'tmdb', kind: 'movie', id: '777' } as const
    const result = await identify(
      {
        parsed: parseMediaPath('/m/x.mkv'),
        fileHash: { hash: 'abc', size: 1 },
      },
      { provider, hashLookup: { lookup: async () => ref } }
    )
    expect(result).toEqual({ status: 'matched', source: 'hash', ref })
    expect(provider.calls).toEqual([])
  })

  it('中英双标题都参与搜索与打分，续集不会误配', async () => {
    const { result } = run(
      '/m/流浪地球.The.Wandering.Earth.2019.2160p.WEB-DL.mkv'
    )
    expect(await result).toMatchObject({
      status: 'matched',
      source: 'search',
      ref: { id: '535167' },
      scored: { score: 1 },
    })
  })

  it('同名多部时年份决定结果', async () => {
    expect(await run('/m/Heat.1995.1080p.mkv').result).toMatchObject({
      status: 'matched',
      ref: { id: '1' },
    })
  })

  it('没有年份可比的同名片同分：不按热度硬选，进待确认（热度高的排前）', async () => {
    const result = await run('/m/Heat.1080p.mkv').result
    expect(result).toMatchObject({
      status: 'review',
      candidates: [
        { candidate: { ref: { id: '2' } } },
        { candidate: { ref: { id: '1' } } },
      ],
    })
  })

  it('带年份搜不到时去掉年份重搜，并试“标题 + 年份”整体当标题，最后取详情精排', async () => {
    const { provider, result } = run('/m/The.Matrix.2001.mkv')
    const r = await result
    expect(provider.calls).toEqual([
      'search:movie:The Matrix:2001',
      'search:movie:The Matrix:',
      'search:movie:The Matrix 2001:',
      'details:movie:603',
    ])
    // 标题满分、年份差 2 年 → 0.6/0.85 ≈ 0.71，进入待确认
    expect(r).toMatchObject({
      status: 'review',
      candidates: [{ candidate: { ref: { id: '603' } } }],
    })
  })

  it('搜不到任何候选时未匹配', async () => {
    expect(await run('/m/Totally.Unknown.Film.2020.mkv').result).toEqual({
      status: 'unmatched',
      candidates: [],
    })
  })

  it('附加内容跳过识别', async () => {
    const { provider, result } = run('/m/Dune (2021)/Featurettes/Making Of.mkv')
    expect(await result).toEqual({ status: 'skipped', reason: 'extra' })
    expect(provider.calls).toEqual([])
  })
})
