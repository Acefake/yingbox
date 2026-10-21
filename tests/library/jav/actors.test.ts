/**
 * 演员资料来源：用录制的页面（tests/fixtures/jav/actors，已裁掉无关部分；*-synthetic 为按选择器构造）
 * 验证字段提取、查询流程（检索 → 资料页、精确命中就地解析）、gfriends 索引只拉一次、聚合规则。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeActorProfiles } from '../../../src/main/library/providers/jav/actors/aggregate'
import {
  createActorSources,
  lookupActor,
  sourcesForGender,
} from '../../../src/main/library/providers/jav/actors'
import {
  calendarDate,
  stripAnnotations,
} from '../../../src/main/library/providers/jav/actors/names'
import {
  avbaseActors,
  avbaseTalentUrl,
} from '../../../src/main/library/providers/jav/actors/sources/avbase'
import {
  GFRIENDS_RAW,
  type GfriendsSnapshot,
  createGfriendsSource,
  flattenFiletree,
} from '../../../src/main/library/providers/jav/actors/sources/gfriends'
import {
  javdbActors,
  javdbSearchUrl,
  parseJavdbActor,
  pickJavdbActor,
} from '../../../src/main/library/providers/jav/actors/sources/javdb'
import {
  minnano,
  minnanoSearchUrl,
  parseMinnanoFigure,
  parseMinnanoName,
  parseMinnanoProfile,
  pickMinnanoSearch,
} from '../../../src/main/library/providers/jav/actors/sources/minnano'
import {
  THEPORNDB_GRAPHQL,
  createThePornDbSource,
  performerProfile,
} from '../../../src/main/library/providers/jav/actors/sources/theporndb'
import {
  clipOverview,
  overviewBlocks,
} from '../../../src/main/library/providers/jav/actors/sources/wiki-overview'
import {
  createWikipediaSource,
  isAvDescription,
} from '../../../src/main/library/providers/jav/actors/sources/wikipedia'
import type {
  ActorContext,
  ActorProfile,
} from '../../../src/main/library/providers/jav/actors/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../fixtures/jav/actors', name), 'utf8')

/** 按 URL（或 URL 前缀）返回内容的假上下文；没登记的地址当 404。 */
function pages(
  map: Record<string, string>,
  match: 'exact' | 'prefix' = 'exact'
): ActorContext & { seen: string[] } {
  const seen: string[] = []
  return {
    seen,
    page: async url => {
      seen.push(url)
      if (match === 'exact') return map[url] ?? null
      const key = Object.keys(map).find(k => url.startsWith(k))
      return key ? map[key] : null
    },
  }
}

describe('工具函数', () => {
  it('日期与注记括号', () => {
    expect(calendarDate('1993年08月16日 （現在 32歳）しし座')).toBe(
      '1993-08-16'
    )
    expect(calendarDate('+1993-08-16T00:00:00Z')).toBe('1993-08-16')
    expect(calendarDate('2023/2/30')).toBeUndefined()
    expect(stripAnnotations('相川美羽(tenshigao)')).toBe('相川美羽')
  })
})

describe('gfriends', () => {
  const tree = fixture('gfriends-filetree.json')

  it('索引：目录字母序先到先得，去掉 ?t=', () => {
    const index = flattenFiletree(JSON.parse(tree))
    expect(index.get('三上悠亜.jpg')).toBe(
      'Content/0-Hand-Storage/三上悠亜.jpg'
    )
  })

  it('索引只拉一次（并发查询共用），并写入 store', async () => {
    const ctx = pages({ [`${GFRIENDS_RAW}/Filetree.json`]: tree })
    let saved: GfriendsSnapshot | undefined
    const source = createGfriendsSource({
      store: { load: async () => null, save: async s => void (saved = s) },
    })
    const [a, b, missing] = await Promise.all([
      source.fetch('三上悠亜', ctx),
      source.fetch('河北彩花', ctx),
      source.fetch('不存在的人', ctx),
    ])
    expect(ctx.seen).toHaveLength(1)
    expect(a?.images[0]).toBe(
      `${GFRIENDS_RAW}/Content/0-Hand-Storage/${encodeURIComponent('三上悠亜.jpg')}`
    )
    expect(b?.url).toContain('/blob/master/Content/')
    expect(missing).toBeNull()
    expect(Object.keys(saved!.entries)).toContain('黒木澪.jpg')
  })

  it('store 里的新鲜快照直接用，不发请求；拉取失败时退回过期快照', async () => {
    const entries = { '三上悠亜.jpg': 'Content/x/三上悠亜.jpg' }
    const fresh = createGfriendsSource({
      store: {
        load: async () => ({ fetchedAt: 0, entries }),
        save: async () => {},
      },
      now: () => 1000,
    })
    const ctx = pages({})
    expect((await fresh.fetch('三上悠亜', ctx))?.images).toHaveLength(1)
    expect(ctx.seen).toHaveLength(0)

    const stale = createGfriendsSource({
      store: {
        load: async () => ({ fetchedAt: 0, entries }),
        save: async () => {},
      },
      now: () => 30 * 86_400_000,
    })
    const failing: ActorContext = {
      page: async () => {
        throw new Error('blocked')
      },
    }
    expect(await stale.fetch('三上悠亜', failing)).not.toBeNull()
  })
})

describe('みんなのAV', () => {
  const html = fixture('minnano-681074.html')
  const url = 'https://www.minnano-av.com/actress681074.html'

  it('资料页：名字 / 读音 / 别名 / 生日 / 身材 / 出身地 / 头像', () => {
    expect(parseMinnanoProfile(html, url)).toEqual({
      source: 'minnano',
      name: '三上悠亜',
      aliases: ['みかみゆあ', 'Mikami Yua', '鬼頭桃菜', 'ヒュージョン亀頭'],
      gender: 'female',
      birthday: '1993-08-16',
      birthplace: '愛知県',
      height: 159,
      bust: 91,
      waist: 56,
      hip: 88,
      cup: 'H',
      images: ['https://www.minnano-av.com/p_actress_125_125/013/681074.jpg'],
      ids: { minnano: '681074' },
      url,
    })
  })

  it('名字行与サイズ', () => {
    expect(parseMinnanoName('鬼頭桃菜(SKE48チームE) （ / ）')).toEqual([
      '鬼頭桃菜',
      [],
    ])
    expect(parseMinnanoFigure('T160 / B85 / W58 / H86')).toEqual({
      height: 160,
      bust: 85,
      waist: 58,
      hip: 86,
    })
  })

  it('检索：重定向到资料页时就地解析，只发一次请求', async () => {
    const ctx = pages({ [minnanoSearchUrl('三上悠亜')]: html })
    expect((await minnano.fetch('三上悠亜', ctx))?.birthday).toBe('1993-08-16')
    expect(ctx.seen).toHaveLength(1)
  })

  it('检索结果：只认去掉注记后同名的一行，不回退首条', async () => {
    const search = fixture('minnano-search-synthetic.html')
    expect(pickMinnanoSearch(search, '三上悠亜')).toBe(url)
    expect(pickMinnanoSearch(search, '三上')).toBeUndefined()
    const ctx = pages({ [minnanoSearchUrl('三上悠亜')]: search, [url]: html })
    expect((await minnano.fetch('三上悠亜', ctx))?.name).toBe('三上悠亜')
  })
})

describe('JavDB 演员', () => {
  it('演员页（英文界面）：名字 / 头像 / 默认女优', () => {
    const r = parseJavdbActor(
      fixture('javdb-actor-EvkJ.html'),
      'https://javdb.com/actors/EvkJ'
    )
    expect(r).toEqual({
      source: 'javdb',
      name: '河北彩花',
      aliases: [],
      gender: 'female',
      images: ['https://c0.jdbstatic.com/avatars/ev/EvkJ.jpg'],
      ids: { javdb: 'EvkJ' },
      url: 'https://javdb.com/actors/EvkJ',
    })
  })

  it('男优：性别标记、别名、跳过影片数与占位头像', () => {
    const r = parseJavdbActor(fixture('javdb-actor-male-synthetic.html'), 'x')!
    expect(r).toMatchObject({
      name: 'しみけん',
      aliases: ['清水健', '志水健'],
      gender: 'male',
      images: [],
      ids: { javdb: 'Xy9' },
    })
  })

  it('检索：按名字或 title 别名精确匹配，再取演员页', async () => {
    const search = fixture('javdb-search-synthetic.html')
    expect(pickJavdbActor(search, '河北彩伽')).toBe(
      'https://javdb.com/actors/EvkJ'
    )
    expect(pickJavdbActor(search, '河北')).toBeUndefined()
    const ctx = pages({
      [javdbSearchUrl('河北彩花')]: search,
      'https://javdb.com/actors/EvkJ': fixture('javdb-actor-EvkJ.html'),
    })
    expect((await javdbActors.fetch('河北彩花', ctx))?.ids).toEqual({
      javdb: 'EvkJ',
    })
  })
})

describe('AVBase 演员', () => {
  it('人物页：basic_info 身材 / 生日 / 出身地，读音进别名', async () => {
    const url = avbaseTalentUrl('三上悠亜')
    const r = await avbaseActors.fetch(
      '三上悠亜',
      pages({ [url]: fixture('avbase-talent-mikami.html') })
    )
    expect(r).toEqual({
      source: 'avbase',
      name: '三上悠亜',
      aliases: ['みかみゆあ'],
      birthday: '1993-08-16',
      birthplace: '愛知県名古屋市中区',
      height: 159,
      bust: 90,
      waist: 57,
      hip: 88,
      cup: 'H',
      images: ['https://pics.dmm.co.jp/mono/actjpgs/mikami_yua.jpg'],
      ids: { avbase: '4822' },
      url,
    })
  })

  it('404 是查无此人', async () => {
    expect(await avbaseActors.fetch('不存在', pages({}))).toBeNull()
  })
})

describe('维基百科', () => {
  const ctx = (): ActorContext & { seen: string[] } =>
    pages(
      {
        'https://www.wikidata.org/w/api.php?action=wbsearchentities': fixture(
          'wikidata-search-mikami.json'
        ),
        'https://www.wikidata.org/w/api.php?action=wbgetentities': fixture(
          'wikidata-entities-mikami.json'
        ),
        'https://ja.wikipedia.org/w/api.php?action=query': fixture(
          'jawiki-extract-mikami.json'
        ),
      },
      'prefix'
    )

  it('AV 关键词：「女優」单独不算', () => {
    expect(isAvDescription('日本の女性タレント、元AV女優')).toBe(true)
    expect(isAvDescription('Japanese adult video actress')).toBe(true)
    expect(isAvDescription('日本の女優')).toBe(false)
  })

  it('检索 → 批量核对实体 → 日文词条简介，共 3 次请求', async () => {
    const c = ctx()
    const r = await createWikipediaSource().fetch('三上悠亜', c)
    expect(c.seen).toHaveLength(3)
    expect(r).toMatchObject({
      source: 'wikipedia',
      name: '三上悠亜',
      aliases: ['三上悠亞', 'Yua Mikami'],
      gender: 'female',
      birthday: '1993-08-16',
      height: 159,
      tagline: '日本の女性タレント、元AV女優',
      ids: { wikidata: 'Q22128111', imdb: expect.any(String) },
      url: `https://ja.wikipedia.org/wiki/${encodeURIComponent('三上悠亜')}`,
    })
    expect(r!.overview!.startsWith('三上悠亜（みかみ ゆあ')).toBe(true)
    expect(r!.overview!.length).toBeLessThanOrEqual(1500)
    expect(r!.overview).toContain('2006年 モーニング娘。')
    expect(r!.overview).not.toContain('== ')
  })

  it('名字对不上的实体不收', async () => {
    expect(await createWikipediaSource().fetch('三上', ctx())).toBeNull()
  })

  it('章节白名单：作品等章节不取', () => {
    const blocks = overviewBlocks(
      '导语。\n\n== 作品 ==\n片名\n\n== 人物 ==\n=== 趣味 ===\n喜欢猫。'
    )
    expect(blocks).toEqual(['导语。', '喜欢猫。'])
    expect(
      clipOverview(['一'.repeat(20), '二二。三三三。'.repeat(10)], 60)
    ).toMatch(/。…$/)
  })
})

describe('ThePornDB 演员', () => {
  const perf = {
    id: 'p1',
    name: 'Yua Mikami',
    aliases: ['三上悠亜', 'Mikami Yua'],
    gender: 'FEMALE',
    birth_date: '1993-08-16',
    country: 'JP',
    height: 159,
    deleted: false,
    measurements: { cup_size: 'h', band_size: 90, waist: 57, hip: 88 },
    images: [
      { url: 'https://img/s.jpg', width: 100, height: 100 },
      { url: 'https://img/l.jpg', width: 600, height: 900 },
    ],
    urls: [
      { url: 'https://twitter.com/yua_mikami', type: 'TWITTER' },
      { url: 'https://theporndb.net/x', type: 'HOMEPAGE' },
    ],
  }

  it('条目 → 资料：头像按面积、外站 id、跳过本站链接', () => {
    expect(performerProfile(perf)).toMatchObject({
      name: 'Yua Mikami',
      aliases: ['三上悠亜', 'Mikami Yua'],
      cup: 'H',
      bust: 90,
      images: ['https://img/l.jpg', 'https://img/s.jpg'],
      ids: { theporndb: 'p1', twitter: 'https://twitter.com/yua_mikami' },
    })
  })

  it('没 token 不发请求；有 token 时跟随合并目标', async () => {
    const calls: unknown[] = []
    const ctx: ActorContext = {
      page: async () => null,
      postJson: async (url, body) => {
        expect(url).toBe(THEPORNDB_GRAPHQL)
        calls.push(body)
        const { variables } = body as { variables: Record<string, string> }
        return variables.term
          ? {
              data: {
                searchPerformer: [
                  { ...perf, id: 'old', deleted: true, merged_into_id: 'p1' },
                ],
              },
            }
          : { data: { findPerformer: perf } }
      },
    }
    expect(
      await createThePornDbSource({ token: () => '' }).fetch('三上悠亜', ctx)
    ).toBeNull()
    expect(calls).toHaveLength(0)
    const r = await createThePornDbSource({ token: () => 't' }).fetch(
      '三上悠亜',
      ctx
    )
    expect(r?.ids.theporndb).toBe('p1')
    expect(calls).toHaveLength(2)
  })
})

describe('聚合', () => {
  const base = (
    p: Partial<ActorProfile> & Pick<ActorProfile, 'source'>
  ): ActorProfile => ({
    name: '三上悠亜',
    aliases: [],
    images: [],
    ids: {},
    ...p,
  })

  it('标量按资料优先级空才填，头像来源优先，别名并集', () => {
    const r = mergeActorProfiles(
      '三上悠亜',
      [
        base({ source: 'gfriends', images: ['g.jpg'] }),
        base({
          source: 'minnano',
          height: 159,
          bust: 91,
          images: ['m.jpg'],
          aliases: ['鬼頭桃菜'],
          url: 'mu',
        }),
        base({
          source: 'avbase',
          bust: 90,
          birthday: '1993-08-16',
          images: ['a.jpg'],
          ids: { avbase: '1' },
        }),
        base({
          source: 'wikipedia',
          name: '三上悠亞',
          overview: '简介',
          ids: { wikidata: 'Q' },
        }),
      ],
      { profile: ['avbase', 'minnano', 'wikipedia'], image: ['gfriends'] }
    )!
    expect(r).toMatchObject({
      bust: 90,
      height: 159,
      birthday: '1993-08-16',
      overview: '简介',
      aliases: ['鬼頭桃菜', '三上悠亞'],
      images: ['g.jpg', 'a.jpg', 'm.jpg'],
      ids: { avbase: '1', wikidata: 'Q' },
      urls: { minnano: 'mu' },
      fieldSources: {
        bust: 'avbase',
        height: 'minnano',
        overview: 'wikipedia',
        images: 'gfriends',
      },
    })
    expect(
      mergeActorProfiles('x', [], { profile: ['avbase'], image: [] })
    ).toBeNull()
  })

  it('lookupActor：单个来源失败不影响其它，失败单独报告', async () => {
    const sources = createActorSources()
    const ctx = pages({
      [avbaseTalentUrl('三上悠亜')]: fixture('avbase-talent-mikami.html'),
      [`${GFRIENDS_RAW}/Filetree.json`]: fixture('gfriends-filetree.json'),
    })
    const failing: ActorContext = {
      page: async url => {
        if (url.includes('minnano')) throw new Error('challenge')
        return ctx.page(url)
      },
    }
    const r = await lookupActor('三上悠亜', { sources, ctx: failing })
    expect(r.actor?.height).toBe(159)
    expect(r.actor?.fieldSources.images).toBe('gfriends')
    expect(r.failures.map(f => f.source)).toEqual(['minnano'])
  })

  it('按性别裁剪：未知性别只留男女都收的来源', () => {
    const ids = (g?: 'female' | 'male'): string[] =>
      sourcesForGender(createActorSources(), g).map(s => s.id)
    expect(ids('male')).not.toContain('minnano')
    expect(ids(undefined)).toEqual([
      'avbase',
      'javdb',
      'wikipedia',
      'theporndb',
    ])
    expect(ids('female')).toContain('gfriends')
  })
})
