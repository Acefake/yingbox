/**
 * 两个 JSON 接口站点：ThePornDB（可选，需令牌）与 R18.dev（公开接口）。
 * r18dev 的 fixture 是录制的真实应答；theporndb 的是按 OpenAPI 结构手写的（需要令牌，无法录制）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type JavCode,
  parseJavCode,
} from '../../../src/main/library/providers/jav/number'
import {
  parseObject,
  r18CombinedUrl,
  r18ContentId,
  r18DvdUrl,
  r18Matches,
  r18Record,
  r18dev,
} from '../../../src/main/library/providers/jav/sites/r18dev'
import {
  createThePornDb,
  pickTpdbScene,
  tpdbRecord,
  tpdbScenes,
  tpdbSearchUrl,
} from '../../../src/main/library/providers/jav/sites/theporndb'
import type {
  PageOptions,
  SiteContext,
} from '../../../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../fixtures/jav', name), 'utf8')

/** 按 URL 返回应答的假上下文；记录每次请求的地址与选项，没登记的地址当 404。 */
function pages(
  map: Record<string, string>
): SiteContext & { seen: Array<{ url: string; options?: PageOptions }> } {
  const seen: Array<{ url: string; options?: PageOptions }> = []
  return {
    seen,
    page: async (url, options) => {
      seen.push({ url, options })
      return map[url] ?? null
    },
  }
}

const code = (name: string): JavCode => parseJavCode(name)!

describe('R18.dev', () => {
  const dvd = fixture('r18dev-SSIS-497-dvd.json')
  const combined = fixture('r18dev-ssis497-combined.json')

  it('content_id 写法：前缀小写 + 5 位补零；非常规番号不猜', () => {
    expect(r18ContentId('SSIS-497')).toBe('ssis00497')
    expect(r18ContentId('ABP-1')).toBe('abp00001')
    expect(r18ContentId('259LUXU-1000')).toBeUndefined()
    expect(r18ContentId('010120-001')).toBeUndefined()
  })

  it('番号核对：dvd_id 或去掉厂牌数字前缀的 content_id', () => {
    expect(r18Matches({ dvd_id: 'SSIS-497' }, 'SSIS-497')).toBe(true)
    expect(r18Matches({ content_id: 'ssis00497' }, 'SSIS-497')).toBe(true)
    expect(r18Matches({ content_id: '1sdmu00123' }, 'SDMU-123')).toBe(true)
    expect(r18Matches({ content_id: 'h_1234abc00012' }, 'ABC-012')).toBe(true)
    expect(r18Matches({ content_id: 'ssis00498' }, 'SSIS-497')).toBe(false)
  })

  it('完整条目：日文优先的全部字段', () => {
    const r = r18Record(parseObject(combined)!, 'SSIS-497')!
    expect(r).toMatchObject({
      site: 'r18dev',
      code: 'SSIS-497',
      url: 'https://r18.dev/videos/vod/movies/detail/-/id=ssis497/',
      title:
        '最高のオンナ鷲尾めいが人生最高に尽くす一生忘れられない1日限定愛人契約',
      releaseDate: '2022-08-23',
      runtimeMinutes: 120,
      director: '嵐山みちる',
      studio: 'エスワン ナンバーワンスタイル',
      label: 'S1 NO.1 STYLE',
      series: '一生忘れられない1日限定愛人契約',
      cover: 'https://pics.dmm.co.jp/mono/movie/adult/ssis497/ssis497pl.jpg',
      poster: 'https://pics.dmm.co.jp/mono/movie/adult/ssis497/ssis497ps.jpg',
    })
    expect(r.overview).toBeUndefined()
    expect(r.tags).toEqual([
      '不倫',
      '巨乳',
      '単体作品',
      '淫乱・ハード系',
      'ギリモザ',
      'サンプル動画',
      'ホテル',
    ])
    expect(r.actors).toEqual([
      {
        name: '鷲尾めい',
        photo: 'https://pics.dmm.co.jp/mono/actjpgs/wasio_mei.jpg',
      },
    ])
    expect(r.stills).toHaveLength(10)
    expect(r.stills[0]).toBe(
      'https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497-1.jpg'
    )
  })

  it('查询：先按 DVD 番号拿 content_id，再取完整条目；请求 JSON', async () => {
    const ctx = pages({
      [r18DvdUrl('SSIS-497')]: dvd,
      [r18CombinedUrl('ssis497')]: combined,
    })
    const r = await r18dev.fetch(code('SSIS-497.mp4'), ctx)
    expect(r?.title).toContain('鷲尾めい')
    expect(ctx.seen.map(s => s.url)).toEqual([
      'https://r18.dev/videos/vod/movies/detail/-/dvd_id=ssis-497/json',
      'https://r18.dev/videos/vod/movies/detail/-/combined=ssis497/json',
    ])
    expect(ctx.seen[0].options?.headers?.Accept).toBe('application/json')
  })

  it('没有 DVD 番号时按 content_id 写法试一次；番号对不上当作没有', async () => {
    const digital = JSON.stringify({
      ...JSON.parse(combined),
      content_id: 'ssis00497',
      dvd_id: null,
    })
    const ctx = pages({ [r18CombinedUrl('ssis00497')]: digital })
    const r = await r18dev.fetch(code('SSIS-497.mp4'), ctx)
    expect(r?.url).toBe(
      'https://r18.dev/videos/vod/movies/detail/-/id=ssis00497/'
    )
    expect(ctx.seen).toHaveLength(2)

    const wrong = pages({ [r18CombinedUrl('ssis00498')]: combined })
    expect(await r18dev.fetch(code('SSIS-498.mp4'), wrong)).toBeNull()
  })

  it('只查有码；坏 JSON 当作没有', async () => {
    expect(r18dev.supports('censored')).toBe(true)
    expect(r18dev.supports('fc2')).toBe(false)
    expect(r18dev.supports('uncensored')).toBe(false)
    expect(r18dev.supports('amateur')).toBe(false)
    const ctx = pages({ [r18DvdUrl('SSIS-497')]: '<html>oops</html>' })
    expect(await r18dev.fetch(code('SSIS-497.mp4'), ctx)).toBeNull()
  })
})

describe('ThePornDB', () => {
  const search = fixture('theporndb-SSIS-497.json')

  it('检索地址：有码查 /jav，其它查 /scenes；令牌不进 URL', () => {
    expect(tpdbSearchUrl(code('SSIS-497.mp4'))).toBe(
      'https://api.theporndb.net/jav?q=SSIS-497&per_page=10'
    )
    expect(tpdbSearchUrl(code('HEYZO-0841.mp4'))).toBe(
      'https://api.theporndb.net/scenes?q=HEYZO-0841&per_page=10'
    )
  })

  it('挑条目：sku / external_id / 标题开头归一后相等，不回退首条', () => {
    const scenes = tpdbScenes(search)
    expect(scenes).toHaveLength(2)
    expect(pickTpdbScene(scenes, 'SSIS-497')?._id).toBe(102)
    expect(pickTpdbScene(scenes, 'SSIS-498')?._id).toBe(101)
    expect(pickTpdbScene(scenes, 'SSIS-499')).toBeUndefined()
    expect(pickTpdbScene([{ title: 'ABP-123 foo' }], 'ABP-123')).toBeDefined()
    expect(tpdbScenes('not json')).toEqual([])
  })

  it('条目字段：主档演员去重、秒换分钟、最清晰的图', () => {
    const scene = pickTpdbScene(tpdbScenes(search), 'SSIS-497')!
    expect(tpdbRecord(scene, 'SSIS-497')).toEqual({
      site: 'theporndb',
      code: 'ssis00497',
      url: 'https://theporndb.net/jav/ssis-497-the-best-onna-mei-washio',
      title: 'SSIS-497 The Best Onna, Mei Washio',
      releaseDate: '2022-08-19',
      runtimeMinutes: 121,
      director: 'Michiru Arashiyama',
      studio: 'S1 NO.1 STYLE',
      tags: ['Big Tits', 'Hotel'],
      actors: [
        { name: 'Mei Washio', photo: 'https://cdn.theporndb.net/p/mei.jpg' },
      ],
      overview: 'An unforgettable one-day contract.',
      cover: 'https://cdn.theporndb.net/jav/ssis497-bg-large.jpg',
      poster: 'https://cdn.theporndb.net/jav/ssis497-poster-full.jpg',
      stills: [],
    })
  })

  it('没填令牌：不参与查询，也不发请求', async () => {
    const site = createThePornDb(() => '  ')
    expect(site.supports('censored')).toBe(false)
    const ctx = pages({})
    expect(await site.fetch(code('SSIS-497.mp4'), ctx)).toBeNull()
    expect(ctx.seen).toHaveLength(0)
  })

  it('填了令牌：令牌只在 Authorization 头里，每次查询读当前值', async () => {
    let token: string | undefined = 'secret-1'
    const site = createThePornDb(() => token)
    expect(site.supports('censored')).toBe(true)
    expect(site.supports('fc2')).toBe(true)
    const url = tpdbSearchUrl(code('SSIS-497.mp4'))
    const ctx = pages({ [url]: search })
    const r = await site.fetch(code('SSIS-497.mp4'), ctx)
    expect(r?.studio).toBe('S1 NO.1 STYLE')
    expect(ctx.seen[0].url).not.toContain('secret')
    expect(ctx.seen[0].options?.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer secret-1',
    })
    token = undefined
    expect(site.supports('censored')).toBe(false)
  })
})
