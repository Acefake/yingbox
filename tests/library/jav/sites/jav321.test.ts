/**
 * JAV321：POST 表单搜索（命中即重定向到详情）、扁平信息区解析、素人番号前缀核对；
 * 以及 POST 经 ProviderHttp / curl 出网实现的透传。录制页面为 2026-10-21 实抓。
 */
import { describe, expect, it } from 'vitest'
import { curlArgs } from '../../../../src/main/library/platform/fetch/curl-fetch'
import { ProviderHttp } from '../../../../src/main/library/providers/http/provider-http'
import { parseJavCode } from '../../../../src/main/library/providers/jav/number'
import {
  jav321,
  jav321Image,
  jav321SearchOptions,
  parseJav321Detail,
  sameJav321Code,
} from '../../../../src/main/library/providers/jav/sites/jav321'
import { fixture, pages } from './site-helpers'

const SEARCH = 'http://www.jav321.com/search'

describe('JAV321 解析', () => {
  it('有码详情页：字段、简介、封面 / 海报 / 剧照、演员头像', () => {
    const r = parseJav321Detail(fixture('jav321-SSIS-497.html'))!
    expect(r).toMatchObject({
      site: 'jav321',
      code: 'SSIS-497',
      url: 'http://www.jav321.com/video/ssis00497',
      title:
        '最高のオンナ鷲尾めいが人生最高に尽くす一生忘れられない1日限定愛人契約',
      releaseDate: '2022-08-23',
      runtimeMinutes: 120,
      studio: 'エスワン ナンバーワンスタイル',
      actors: [
        {
          name: '鷲尾めい',
          photo: 'https://pics.dmm.co.jp/mono/actjpgs/wasio_mei.jpg',
        },
      ],
      cover: 'https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497pl.jpg',
      poster: 'https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497ps.jpg',
    })
    expect(r.overview).toMatch(/^「今日だけだから…ね？」/)
    expect(r.overview).not.toMatch(/配信方法|特集/)
    expect(r.stills).toHaveLength(10)
    expect(r.stills[0]).toBe(
      'https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497jp-1.jpg'
    )
  })

  it('类别与系列', () => {
    const r = parseJav321Detail(fixture('jav321-ABP-123.html'))!
    expect(r.code).toBe('ABP-123')
    expect(r.series).toBe('満足度満点ソープ')
    expect(r.tags).toEqual([
      'キャバ嬢・風俗嬢',
      'ハイビジョン',
      '単体作品',
      '巨乳',
    ])
    expect(r.url).toBe('http://www.jav321.com/video/118abp00123')
  })

  it('素人：品番没有数字前缀，封面是厂牌自家大图', () => {
    const r = parseJav321Detail(fixture('jav321-259LUXU-1234.html'))!
    expect(r.code).toBe('LUXU-1234')
    expect(r.studio).toBe('ラグジュTV')
    expect(r.cover).toBe(
      'http://www.jav321.com/images/luxutv/259luxu/1234/pb_e_259luxu-1234.jpg'
    )
    expect(r.stills.length).toBeGreaterThan(0)
    expect(sameJav321Code(r.code, '259LUXU-1234')).toBe(true)
    expect(sameJav321Code(r.code, 'LUXU-1235')).toBe(false)
  })

  it('搜索落空的页面返回 null', () => {
    expect(parseJav321Detail(fixture('jav321-missing.html'))).toBeNull()
  })

  it('图片地址规整', () => {
    expect(jav321Image('http://pics.dmm.co.jp//digital/video/a/apl.jpg')).toBe(
      'https://pics.dmm.co.jp/digital/video/a/apl.jpg'
    )
    expect(jav321Image('https://x.test/nowprinting.gif')).toBeUndefined()
  })
})

describe('JAV321 站点', () => {
  it('一次 POST 表单搜索', async () => {
    const ctx = pages({
      [`POST ${SEARCH} sn=SSIS-497`]: fixture('jav321-SSIS-497.html'),
    })
    const r = await jav321.fetch(parseJavCode('SSIS-497')!, ctx)
    expect(r?.code).toBe('SSIS-497')
    expect(ctx.seen).toHaveLength(1)
    expect(ctx.seen[0].options).toMatchObject({
      method: 'POST',
      body: 'sn=SSIS-497',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  })

  it('搜到的番号对不上按没有处理', async () => {
    const ctx = pages({
      [`POST ${SEARCH} sn=SSIS-498`]: fixture('jav321-SSIS-497.html'),
    })
    expect(await jav321.fetch(parseJavCode('SSIS-498')!, ctx)).toBeNull()
  })

  it('支持有码与素人', () => {
    expect(jav321.supports('censored')).toBe(true)
    expect(jav321.supports('amateur')).toBe(true)
    expect(jav321.supports('uncensored')).toBe(false)
    expect(jav321.supports('fc2')).toBe(false)
  })
})

describe('POST 透传', () => {
  it('ProviderHttp.getText 把 method / body 交给 fetch；GET 不带', async () => {
    const seen: Array<{ method?: string; body?: string }> = []
    const http = new ProviderHttp({
      fetch: async (_url, init) => {
        seen.push({ method: init.method, body: init.body })
        return {
          status: 200,
          headers: { get: () => null },
          text: async () => 'ok',
        }
      },
    })
    const opts = jav321SearchOptions('ABP-123')
    await http.getText({ url: SEARCH, method: opts.method, body: opts.body })
    await http.getText({ url: SEARCH })
    expect(seen).toEqual([
      { method: 'POST', body: 'sn=ABP-123' },
      { method: undefined, body: undefined },
    ])
  })

  it('curl 参数：有 body 时 --data-binary，不加 --request（重定向后改 GET）', () => {
    const args = curlArgs('https://a.test/s', {}, 1000, 15000, 'sn=X')
    expect(args.slice(-4)).toEqual([
      '--data-binary',
      'sn=X',
      '--',
      'https://a.test/s',
    ])
    expect(args).not.toContain('--request')
    expect(curlArgs('https://a.test/s', {}, 1000, 15000)).not.toContain(
      '--data-binary'
    )
  })
})
