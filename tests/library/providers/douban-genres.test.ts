/**
 * 豆瓣补类型：搜索结果挑条目、副标题解析、请求头 / 限速 / 缓存，以及刮削后补全的范围与上限。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../../src/main/library/engine/service'
import {
  GENRE_FILL_REQUEST_LIMIT,
  fillGenresFromDouban,
} from '../../../src/main/library/identify/genre-fill'
import {
  DoubanGenreLookup,
  type DoubanGenreQuery,
  parseCardSubtitle,
  pickDoubanGenres,
} from '../../../src/main/library/providers/douban/douban-genres'
import { MemoryResponseCache } from '../../../src/main/library/providers/http/provider-cache'
import {
  type FetchLike,
  ProviderHttp,
} from '../../../src/main/library/providers/http/provider-http'
import { tempTree } from '../engine/helpers'

const item = (
  title: string,
  year: string,
  subtitle: string,
  type = 'movie'
): unknown => ({
  layout: 'subject',
  target_type: type,
  target: { title, year, card_subtitle: subtitle },
})

const BODY = {
  items: [
    item('让子弹飞', '2010', '中国大陆 中国香港 / 剧情 喜剧 动作 西部 / 姜文'),
    item('越过山丘', '2012', '土耳其 希腊 / 剧情 / 埃敏·阿尔柏'),
  ],
}

describe('豆瓣搜索结果', () => {
  it('副标题：第一段地区（换成代码），第二段类型', () => {
    expect(parseCardSubtitle('美国 / 剧情 犯罪 / 亚当 / 布莱恩')).toEqual({
      genres: ['剧情', '犯罪'],
      countries: ['US'],
    })
    expect(parseCardSubtitle('只有一段')).toBeNull()
  })

  it('片名一致、年份相差不超过 1 年才算；剧集标题去掉季号', () => {
    const q: DoubanGenreQuery = { title: '讓子彈飛', year: 2010, kind: 'movie' }
    expect(pickDoubanGenres(BODY, q)).toEqual({
      genres: ['剧情', '喜剧', '动作', '西部'],
      countries: ['CN', 'HK'],
    })
    expect(pickDoubanGenres(BODY, { ...q, year: 2015 })).toBeNull()
    const tv = {
      items: [item('绝命毒师 第一季', '2008', '美国 / 剧情 犯罪 / 亚当', 'tv')],
    }
    expect(
      pickDoubanGenres(tv, { title: '绝命毒师', year: 2008, kind: 'tv' })
    ).toEqual({ genres: ['剧情', '犯罪'], countries: ['US'] })
  })

  it('外文片名对不上：只接受排第一、类型一致、年份相同的条目', () => {
    const tv = {
      items: [item('绝命毒师 第一季', '2008', '美国 / 剧情 犯罪 / 亚当', 'tv')],
    }
    const q: DoubanGenreQuery = {
      title: 'Breaking Bad',
      year: 2008,
      kind: 'tv',
    }
    expect(pickDoubanGenres(tv, q)?.genres).toEqual(['剧情', '犯罪'])
    expect(pickDoubanGenres(tv, { ...q, year: 2009 })).toBeNull()
    expect(pickDoubanGenres(tv, { ...q, kind: 'movie' })).toBeNull()
    expect(pickDoubanGenres(tv, { ...q, year: null })).toBeNull()
    expect(pickDoubanGenres('<html>', q)).toBeNull()
  })
})

describe('DoubanGenreLookup', () => {
  it('带 Referer 与移动 UA 请求 rexxar 搜索；两次请求至少隔 2 秒；结果缓存', async () => {
    const clock = {
      t: 0,
      now: () => clock.t,
      sleep: async (ms: number) => {
        clock.t += ms
        await Promise.resolve()
      },
    }
    const calls: Array<{
      url: string
      at: number
      headers: Record<string, string>
    }> = []
    const fetch = (async (
      url: string,
      init: { headers: Record<string, string> }
    ) => {
      calls.push({ url, at: clock.now(), headers: init.headers })
      return {
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(BODY),
      }
    }) as FetchLike
    const cache = new MemoryResponseCache()
    const http = new ProviderHttp({
      fetch,
      cache,
      rps: 0.5,
      burst: 1,
      concurrency: 1,
      clock,
    })
    const lookup = new DoubanGenreLookup(http, cache, clock.now)
    const q: DoubanGenreQuery = { title: '让子弹飞', year: 2010, kind: 'movie' }
    expect(lookup.cached(q)).toBe(false)
    expect((await lookup.lookup(q))?.genres).toContain('喜剧')
    expect(lookup.cached(q)).toBe(true)
    await lookup.lookup(q)
    await lookup.lookup({ title: '越过山丘', year: 2012, kind: 'movie' })
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toMatch(
      /^https:\/\/m\.douban\.com\/rexxar\/api\/v2\/search\/movie\?q=/
    )
    expect(decodeURIComponent(calls[0].url)).toContain('让子弹飞 2010')
    expect(calls[0].headers.Referer).toMatch(/^https:\/\/m\.douban\.com\//)
    expect(calls[0].headers['User-Agent']).toMatch(/Mobile/)
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(2000)
  })
})

describe('刮削后的豆瓣补类型', () => {
  let tmdbTree: ReturnType<typeof tempTree>
  let javTree: ReturnType<typeof tempTree>
  let service: LibraryService

  beforeEach(async () => {
    tmdbTree = tempTree()
    javTree = tempTree()
    service = new LibraryService({ dbPath: ':memory:', watch: false })
    await service.start()
  })
  afterEach(async () => {
    await service.close()
    tmdbTree.cleanup()
    javTree.cleanup()
  })

  async function addItems(): Promise<Map<string, number>> {
    tmdbTree.write('让子弹飞.2010.mkv')
    tmdbTree.write('Heat.1995.mkv')
    javTree.write('SSIS-497/SSIS-497.mp4')
    const automation = { identify: false, watch: false } as const
    await service.addLibrary({ root: tmdbTree.root, kind: 'movie', automation })
    await service.addLibrary({
      root: javTree.root,
      kind: 'movie',
      source: 'jav',
      automation,
    })
    await service.queue.idle()
    const rows = service.db
      .prepare('SELECT id, title FROM media_items WHERE parent_id IS NULL')
      .all() as Array<{ id: number; title: string }>
    // Heat 已有类型（刮削来的），不再查
    service.db
      .prepare(
        "UPDATE media_items SET genres = '[\"犯罪\"]' WHERE title = 'Heat'"
      )
      .run()
    return new Map(rows.map(r => [r.title, Number(r.id)]))
  }

  it('只查 TMDB 库里没有类型的条目，番号库不碰；只补空字段', async () => {
    const ids = await addItems()
    const asked: DoubanGenreQuery[] = []
    const changed = await fillGenresFromDouban(
      {
        db: service.db,
        lookup: {
          cached: () => false,
          lookup: async q => {
            asked.push(q)
            return { genres: ['剧情', '喜剧'], countries: ['CN'] }
          },
        },
      },
      [...ids.values()]
    )
    expect(asked.map(q => q.title)).toEqual(['让子弹飞'])
    expect(asked[0]).toMatchObject({ year: 2010, kind: 'movie' })
    expect(changed).toEqual([ids.get('让子弹飞')])
    const row = service.db
      .prepare('SELECT genres, metadata FROM media_items WHERE id = ?')
      .get(ids.get('让子弹飞')!) as { genres: string; metadata: string }
    expect(JSON.parse(row.genres)).toEqual(['剧情', '喜剧'])
    expect(JSON.parse(row.metadata)).toEqual({
      level: 'local',
      countries: ['CN'],
      source: 'douban',
    })
  })

  it('单次最多发 50 个请求（命中缓存的不算）；出错就停下', async () => {
    const ids = await addItems()
    const many = Array.from({ length: 60 }, (_, i) => i + 1)
    for (const n of many) {
      service.db
        .prepare(
          `INSERT INTO media_items (library_id, type, local_key, title, sort_title, search_text, match_state, added_at, updated_at)
           SELECT library_id, 'movie', 'extra:' || ?, '片' || ?, '', '', 'unmatched', 0, 0
           FROM media_items WHERE id = ?`
        )
        .run(n, n, ids.get('让子弹飞')!)
    }
    const all = (
      service.db.prepare('SELECT id FROM media_items').all() as Array<{
        id: number
      }>
    ).map(r => Number(r.id))
    let requests = 0
    await fillGenresFromDouban(
      {
        db: service.db,
        lookup: {
          cached: q => q.title === '片1',
          lookup: async q => {
            if (q.title !== '片1') requests++
            return null
          },
        },
      },
      all
    )
    expect(requests).toBe(GENRE_FILL_REQUEST_LIMIT)

    let calls = 0
    const logs: string[] = []
    await fillGenresFromDouban(
      {
        db: service.db,
        log: m => logs.push(m),
        lookup: {
          cached: () => false,
          lookup: async () => {
            calls++
            throw new Error('302 到 sec.douban.com')
          },
        },
      },
      all
    )
    expect(calls).toBe(1)
    expect(logs[0]).toMatch(/豆瓣补类型中止/)
  })
})
