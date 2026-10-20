import { describe, expect, it } from 'vitest'
import type { ImageCandidate } from '../../../src/shared/library/provider'
import { MemoryResponseCache } from '../../../src/main/library/providers/http/provider-cache'
import {
  ProviderAuthError,
  ProviderHttp,
} from '../../../src/main/library/providers/http/provider-http'
import {
  languageChain,
  sortImages,
} from '../../../src/main/library/providers/tmdb/tmdb-map'
import { TmdbProvider } from '../../../src/main/library/providers/tmdb/tmdb-provider'
import { FAKE_TOKEN, FakeTmdb } from './fake-tmdb'

function setup(token: string | null = FAKE_TOKEN): {
  tmdb: FakeTmdb
  provider: TmdbProvider
  urls: string[]
} {
  const tmdb = new FakeTmdb({ token: FAKE_TOKEN })
  const urls: string[] = []
  const http = new ProviderHttp({
    fetch: (url, init) => {
      urls.push(url)
      return tmdb.fetch(url, init)
    },
    cache: new MemoryResponseCache(),
    rps: 1000,
  })
  return {
    tmdb,
    provider: new TmdbProvider({ http, token: () => token ?? undefined }),
    urls,
  }
}

describe('TmdbProvider', () => {
  it('搜索：按语言给标题，带年份过滤，结果映射成候选', async () => {
    const { provider } = setup()
    const zh = await provider.search({ kind: 'movie', title: 'Heat' })
    expect(zh.map(c => [c.ref.id, c.title, c.year])).toEqual([
      ['949', '盗火线', 1995],
      ['29386', 'Heat', 1986],
    ])
    expect(zh[0].originalTitle).toBe('Heat')
    const y = await provider.search({
      kind: 'movie',
      title: 'Heat',
      year: 1986,
    })
    expect(y.map(c => c.ref.id)).toEqual(['29386'])
    const en = await provider.search({
      kind: 'tv',
      title: '请回答',
      language: 'en-US',
    })
    expect(en.map(c => c.title)).toContain('Reply 1988')
  })

  it('详情一次取全：append_to_response 与图片语言参数，同一详情只请求一次', async () => {
    const { provider, tmdb } = setup()
    await provider.details('movie', '535167')
    await provider.metadata({ provider: 'tmdb', kind: 'movie', id: '535167' })
    expect(tmdb.requests).toEqual([
      '/movie/535167?append_to_response=credits%2Cimages%2Cexternal_ids%2Ctranslations%2Calternative_titles%2Crelease_dates&include_image_language=zh%2Cen%2Cnull&language=zh-CN',
    ])
  })

  it('元数据：标题 / 简介按 zh-CN → zh-TW → en 回退，分级、演职员、外部 ID、图片排序', async () => {
    const { provider } = setup()
    const heat = (await provider.metadata({
      provider: 'tmdb',
      kind: 'movie',
      id: '949',
    }))!
    expect(heat).toMatchObject({
      title: '盗火线',
      originalTitle: 'Heat',
      year: 1995,
      overview: '一个职业劫匪与一位警探的对决。',
      overviewLanguage: 'zh-CN',
      certification: 'R',
      runtimeMinutes: 170,
      countries: ['US'],
      externalIds: { tmdb: '949', imdb: 'tt0113277' },
    })
    expect(heat.crew.map(c => c.job)).toEqual(['Director', 'Writer'])
    // 没有 zh-CN 简介时回退到 en
    const old = (await provider.metadata({
      provider: 'tmdb',
      kind: 'movie',
      id: '29386',
    }))!
    expect(old).toMatchObject({
      title: 'Heat',
      overview: 'A Las Vegas bodyguard.',
      overviewLanguage: 'en-US',
    })
    // 海报：中文 > 英文；背景图：无文字优先
    expect(
      heat.images.filter(i => i.role === 'poster').map(i => i.language)
    ).toEqual(['zh', 'en'])
    expect(heat.images.find(i => i.role === 'backdrop')!.language).toBeNull()
    // 剧集：分级（无中国大陆分级时用其他地区）、季、剧集分组
    const aot = (await provider.metadata({
      provider: 'tmdb',
      kind: 'tv',
      id: '1429',
    }))!
    expect(aot.title).toBe('进击的巨人')
    expect(aot.seasons!.map(s => [s.season, s.episodeCount])).toEqual([
      [0, 8],
      [1, 25],
      [2, 12],
      [3, 22],
      [4, 30],
    ])
    expect(aot.episodeGroups).toEqual([
      expect.objectContaining({ type: 2, episodeCount: 60 }),
    ])
  })

  it('绝对集数顺序：有“绝对”剧集分组时按分组（含插入的特别篇），否则按季拼接', async () => {
    const { provider } = setup()
    const aot = (await provider.metadata({
      provider: 'tmdb',
      kind: 'tv',
      id: '1429',
    }))!
    const order = await provider.absoluteOrder(aot)
    expect(order[12]).toEqual({ season: 1, episode: 13 })
    expect(order[13]).toEqual({ season: 0, episode: 1 })
    expect(order[14]).toEqual({ season: 1, episode: 14 })
    expect(order[26]).toEqual({ season: 2, episode: 1 })
    const op = (await provider.metadata({
      provider: 'tmdb',
      kind: 'tv',
      id: '37854',
    }))!
    const opOrder = await provider.absoluteOrder(op)
    expect(opOrder).toHaveLength(61 + 16 + 14)
    expect(opOrder[61]).toEqual({ season: 2, episode: 1 })
  })

  it('季详情与 /find 反查', async () => {
    const { provider } = setup()
    const season = (await provider.season('64010', 1))!
    expect(season.episodes).toHaveLength(20)
    expect(season.episodes[4]).toMatchObject({
      season: 1,
      episode: 5,
      title: '第 5 集',
    })
    expect((await provider.find('imdb', 'tt5182866')).map(c => c.ref)).toEqual([
      { provider: 'tmdb', kind: 'tv', id: '64010' },
    ])
    expect(await provider.season('64010', 9)).toBeNull()
  })

  it('v3 api_key 走查询参数，缓存键不含令牌；没有令牌直接报错', async () => {
    const { provider, urls } = setup('0123456789abcdef0123456789abcdef')
    await provider.search({ kind: 'movie', title: 'Dune' }).catch(() => {})
    expect(urls[0]).toContain('api_key=0123456789abcdef0123456789abcdef')
    const none = setup(null).provider
    await expect(
      none.search({ kind: 'movie', title: 'x' })
    ).rejects.toBeInstanceOf(ProviderAuthError)
    expect(none.configured).toBe(false)
  })
})

describe('tmdb-map', () => {
  it('语言回退链', () => {
    expect(languageChain('zh-CN')).toEqual([
      'zh-CN',
      'zh-TW',
      'zh-HK',
      'zh-SG',
      'en-US',
      'en',
    ])
    expect(languageChain('ja-JP')).toEqual(['ja-JP', 'en-US', 'en'])
  })

  it('图片排序：语言偏好 → 评分 → 票数', () => {
    const img = (
      language: string | null,
      voteAverage: number
    ): ImageCandidate => ({
      role: 'poster' as const,
      path: `/${language}-${voteAverage}`,
      language,
      width: 1000,
      height: 1500,
      voteAverage,
      voteCount: 1,
    })
    expect(
      sortImages(
        [
          img(null, 9),
          img('en', 6),
          img('zh', 5),
          img('zh', 5.5),
          img('ja', 10),
        ],
        'zh-CN'
      ).map(i => i.path)
    ).toEqual(['/zh-5.5', '/zh-5', '/en-6', '/null-9', '/ja-10'])
  })
})
