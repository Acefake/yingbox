/**
 * 刮削语言统一：主设置下发到片库引擎（setScrapePrefs）、TMDB 语言每次请求读、中文片名缺失用原名、
 * 简介缺中文由豆瓣补、图片清晰度映射、宿主下发规则。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleRpc } from '../../src/main/library/engine/rpc'
import { LibraryService } from '../../src/main/library/engine/service'
import { fillOverviewsFromDouban } from '../../src/main/library/identify/overview-fill'
import { syncScrapePrefs } from '../../src/main/library/platform/scrape-sync'
import {
  DoubanIntroLookup,
  cleanIntro,
} from '../../src/main/library/providers/douban/douban-intro'
import { pickDoubanSubject } from '../../src/main/library/providers/douban/douban-genres'
import { MemoryResponseCache } from '../../src/main/library/providers/http/provider-cache'
import {
  type FetchLike,
  ProviderHttp,
} from '../../src/main/library/providers/http/provider-http'
import { ScrapePrefsStore } from '../../src/main/library/providers/scrape-prefs-store'
import { metadataFromDetails } from '../../src/main/library/providers/tmdb/tmdb-map'
import { TmdbProvider } from '../../src/main/library/providers/tmdb/tmdb-provider'
import type { TmdbTvDetails } from '../../src/main/library/providers/tmdb/tmdb-types'
import {
  DEFAULT_SCRAPE_PREFS,
  parseScrapePrefs,
  scrapePrefsFrom,
  tmdbImageSizes,
} from '../../src/shared/library/scrape-prefs'
import { parseRpcParams } from '../../src/shared/library/ipc'
import { tempTree } from './engine/helpers'
import { FAKE_TOKEN, FakeTmdb } from './providers/fake-tmdb'

/** 只有英文译名、原名是韩文的剧（TMDB 上新剧的常见情况）。 */
const KOREAN_TV = {
  id: 1,
  name: 'Squid Game',
  original_name: '오징어 게임',
  first_air_date: '2021-09-17',
  overview: '',
  translations: {
    translations: [
      {
        iso_639_1: 'en',
        iso_3166_1: 'US',
        data: {
          name: 'Squid Game',
          overview: 'A deadly game.',
          tagline: 'Win.',
        },
      },
    ],
  },
} as unknown as TmdbTvDetails

describe('TMDB 文本按元数据语言挑选', () => {
  it('中文：没有中文片名用原名（不退英文）；简介先放英文并记语言；不放英文标语', () => {
    const meta = metadataFromDetails('tv', KOREAN_TV, 'zh-CN')
    expect(meta.title).toBe('오징어 게임')
    expect(meta.overview).toBe('A deadly game.')
    expect(meta.overviewLanguage).toBe('en-US')
    expect(meta.tagline).toBeUndefined()
  })

  it('中文：有任一中文地区的译名就用中文（含没有地区的 zh）', () => {
    const tv = structuredClone(KOREAN_TV) as unknown as {
      translations: { translations: unknown[] }
    }
    tv.translations.translations.push({
      iso_639_1: 'zh',
      iso_3166_1: 'MO',
      data: { name: '鱿鱼游戏', overview: '一场致命的游戏。' },
    })
    const meta = metadataFromDetails(
      'tv',
      tv as unknown as TmdbTvDetails,
      'zh-CN'
    )
    expect(meta.title).toBe('鱿鱼游戏')
    expect(meta.overview).toBe('一场致命的游戏。')
    expect(meta.overviewLanguage).toBe('zh-MO')
  })

  it('其他语言照常退到英文', () => {
    const meta = metadataFromDetails('tv', KOREAN_TV, 'ja-JP')
    expect(meta.title).toBe('Squid Game')
    expect(meta.tagline).toBe('Win.')
  })
})

describe('TmdbProvider 语言每次请求读', () => {
  it('切换语言后新请求立即带新语言；第二语言与主语言不同', async () => {
    const tmdb = new FakeTmdb({ token: FAKE_TOKEN })
    let language = 'zh-CN'
    const provider = new TmdbProvider({
      http: new ProviderHttp({
        fetch: tmdb.fetch,
        cache: new MemoryResponseCache(),
        rps: 1000,
      }),
      token: () => FAKE_TOKEN,
      language: () => language,
    })
    expect(provider.secondaryLanguage).toBe('en-US')
    await provider.search({ kind: 'movie', title: 'Heat' })
    language = 'en-US'
    expect(provider.secondaryLanguage).toBe('zh-CN')
    await provider.search({ kind: 'movie', title: 'Heat' })
    const langs = tmdb.requests.map(r =>
      new URLSearchParams(r.split('?')[1]).get('language')
    )
    expect(langs).toEqual(['zh-CN', 'en-US'])
  })
})

describe('刮削偏好', () => {
  it('宽松解析：不认识的值取默认；设置键 → 偏好', () => {
    expect(parseScrapePrefs({ language: 'fr-FR', imageSize: 1 })).toEqual(
      DEFAULT_SCRAPE_PREFS
    )
    const values: Record<string, unknown> = {
      'scrape.metadataLanguage': 'ja-JP',
      'scrape.imageSize.poster': 'original',
      'scrape.imageSize.backdrop': 'w342',
      'scrape.imageSize.actor': 'w780',
    }
    expect(scrapePrefsFrom(k => values[k])).toEqual({
      language: 'ja-JP',
      imageSize: { poster: 'original', backdrop: 'w342', actor: 'w780' },
    })
  })

  it('清晰度档位映射成各类图片的 TMDB 尺寸；默认与原先写出的尺寸一致', () => {
    expect(tmdbImageSizes(DEFAULT_SCRAPE_PREFS.imageSize)).toEqual({
      poster: 'w780',
      backdrop: 'w1280',
      profile: 'h632',
    })
    expect(
      tmdbImageSizes({ poster: 'w342', backdrop: 'w342', actor: 'w342' })
    ).toEqual({ poster: 'w342', backdrop: 'w780', profile: 'w185' })
  })

  it('RPC 参数必须是对象', () => {
    expect(() => parseRpcParams('setScrapePrefs', 'zh-CN')).toThrow()
  })

  it('宿主启动时下发一次，只有刮削键变了才再下发，最后一次是最新值', async () => {
    const values: Record<string, unknown> = {
      'scrape.metadataLanguage': 'zh-CN',
    }
    let listener: (key: string) => void = () => {}
    const sent: string[] = []
    await syncScrapePrefs(
      {
        setScrapePrefs: async prefs => {
          sent.push(prefs.language)
        },
      },
      {
        get: (key => values[key]) as never,
        onChange: fn => {
          listener = fn
        },
      }
    )
    expect(sent).toEqual(['zh-CN'])
    listener('pan115.pansouUrl')
    values['scrape.metadataLanguage'] = 'en-US'
    listener('scrape.metadataLanguage')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(sent).toEqual(['zh-CN', 'en-US'])
  })
})

describe('片库引擎里的刮削偏好', () => {
  let service: LibraryService
  let tree: ReturnType<typeof tempTree>
  beforeEach(async () => {
    tree = tempTree()
    service = new LibraryService({ dbPath: ':memory:', watch: false })
    await service.start()
  })
  afterEach(async () => {
    await service.close()
    tree.cleanup()
  })

  it('没下发时为默认；下发后识别模块的 TMDB 语言跟着变', async () => {
    expect(
      await handleRpc(service, { method: 'getScrapePrefs', params: undefined })
    ).toEqual({
      ok: true,
      result: DEFAULT_SCRAPE_PREFS,
    })
    expect(service.identifier.provider.language).toBe('zh-CN')
    await handleRpc(service, {
      method: 'setScrapePrefs',
      params: { ...DEFAULT_SCRAPE_PREFS, language: 'zh-TW' },
    })
    expect(new ScrapePrefsStore(service.db).language()).toBe('zh-TW')
    expect(service.identifier.provider.language).toBe('zh-TW')
  })

  /** 两部电影：一部简介是英文，一部已是中文。 */
  async function items(): Promise<{ en: number; zh: number }> {
    tree.write('Heat.1995.mkv')
    tree.write('让子弹飞.2010.mkv')
    const automation = { identify: false, watch: false } as const
    await service.addLibrary({ root: tree.root, kind: 'movie', automation })
    await service.queue.idle()
    const id = (title: string): number =>
      Number(
        (
          service.db
            .prepare('SELECT id FROM media_items WHERE title = ?')
            .get(title) as { id: number }
        ).id
      )
    const set = (itemId: number, overview: string, language: string): void => {
      service.db
        .prepare(
          'UPDATE media_items SET overview = ?, metadata = ? WHERE id = ?'
        )
        .run(
          overview,
          JSON.stringify({
            level: 'title',
            overview,
            overviewLanguage: language,
          }),
          itemId
        )
    }
    const en = id('Heat')
    const zh = id('让子弹飞')
    set(en, 'A bodyguard.', 'en-US')
    set(zh, '民国年间。', 'zh-CN')
    return { en, zh }
  }

  it('豆瓣补简介：只换非中文简介（列与元数据 JSON 都改），已是中文的不查', async () => {
    const { en, zh } = await items()
    const asked: string[] = []
    const changed = await fillOverviewsFromDouban(
      {
        db: service.db,
        search: {
          cached: () => false,
          subject: async q => {
            asked.push(q.title)
            return { id: '1291841', kind: 'movie', cardSubtitle: '' }
          },
        },
        intro: {
          cached: () => false,
          intro: async () => '职业劫匪与警探的对决。',
        },
      },
      [en, zh]
    )
    expect(asked).toEqual(['Heat'])
    expect(changed).toEqual([en])
    const row = service.db
      .prepare('SELECT overview, metadata FROM media_items WHERE id = ?')
      .get(en) as { overview: string; metadata: string }
    expect(row.overview).toBe('职业劫匪与警探的对决。')
    expect(JSON.parse(row.metadata)).toMatchObject({
      overview: '职业劫匪与警探的对决。',
      overviewLanguage: 'zh-CN',
    })
  })

  it('豆瓣也没有简介时保留英文；请求出错就停下', async () => {
    const { en } = await items()
    const none = await fillOverviewsFromDouban(
      {
        db: service.db,
        search: {
          cached: () => false,
          subject: async () => ({ id: '1', kind: 'movie', cardSubtitle: '' }),
        },
        intro: { cached: () => false, intro: async () => '' },
      },
      [en]
    )
    expect(none).toEqual([])
    const logs: string[] = []
    const failed = await fillOverviewsFromDouban(
      {
        db: service.db,
        search: {
          cached: () => false,
          subject: async () => {
            throw new Error('HTTP 403')
          },
        },
        intro: { cached: () => false, intro: async () => 'x' },
        log: m => logs.push(m),
      },
      [en]
    )
    expect(failed).toEqual([])
    expect(logs[0]).toContain('HTTP 403')
    const row = service.db
      .prepare('SELECT overview FROM media_items WHERE id = ?')
      .get(en) as { overview: string }
    expect(row.overview).toBe('A bodyguard.')
  })
})

describe('豆瓣条目简介', () => {
  it('搜索结果挑出条目 id；详情读 intro 并缓存', async () => {
    const hit = pickDoubanSubject(
      {
        items: [
          {
            target_type: 'movie',
            target: {
              id: '3742360',
              title: '让子弹飞',
              year: '2010',
              card_subtitle: '中国大陆 / 剧情 喜剧',
            },
          },
        ],
      },
      { title: '让子弹飞', year: 2010, kind: 'movie' }
    )
    expect(hit).toEqual({
      id: '3742360',
      kind: 'movie',
      cardSubtitle: '中国大陆 / 剧情 喜剧',
    })

    const urls: string[] = []
    const fetch = (async (url: string) => {
      urls.push(url)
      return {
        status: 200,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            id: '3742360',
            title: '让子弹飞',
            intro: '  民国年间，花钱捐官。\n\n  ',
          }),
      }
    }) as FetchLike
    const cache = new MemoryResponseCache()
    const http = new ProviderHttp({ fetch, cache, rps: 1000 })
    const lookup = new DoubanIntroLookup(http, cache)
    const ref = { id: '3742360', kind: 'movie' as const }
    expect(lookup.cached(ref)).toBe(false)
    expect(await lookup.intro(ref)).toBe('民国年间，花钱捐官。')
    expect(await lookup.intro(ref)).toBe('民国年间，花钱捐官。')
    expect(lookup.cached(ref)).toBe(true)
    expect(urls).toEqual(['https://m.douban.com/rexxar/api/v2/movie/3742360'])
    expect(await lookup.intro({ id: '../x', kind: 'movie' })).toBe('')
  })

  it('太短的简介当作没有', () => {
    expect(cleanIntro('暂无')).toBe('')
  })
})
