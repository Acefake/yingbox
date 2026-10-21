/**
 * DMM 系站点：cid 换算、GraphQL 响应解析与查询流程（fixture 为 2026-10 实抓的 api.video.dmm.co.jp 响应）、
 * 网页兜底（检索页 / DVD 详情页为手写结构，未用真实页面验证；地区限制页为实抓）、官方 API（手写响应）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type JavCode,
  parseJavCode,
} from '../../../../src/main/library/providers/jav/number'
import {
  cidToCode,
  dmmCid,
  pickCid,
  sameCid,
} from '../../../../src/main/library/providers/jav/sites/dmm/cid'
import {
  createDmmApi,
  credentialsFromEnv,
  dmm,
} from '../../../../src/main/library/providers/jav/sites/dmm'
import {
  dmmApiRecord,
  dmmApiUrl,
  parseDmmApi,
} from '../../../../src/main/library/providers/jav/sites/dmm/affiliate'
import {
  DMM_GRAPHQL,
  dmmContentRecord,
  jstDateOf,
  parseGraphql,
} from '../../../../src/main/library/providers/jav/sites/dmm/graphql'
import {
  isRegionBlocked,
  parseDmmMono,
  pickDmmSearch,
} from '../../../../src/main/library/providers/jav/sites/dmm/web'
import type {
  PageOptions,
  SiteContext,
} from '../../../../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../../fixtures/jav', name), 'utf8')

/** 记录请求的假上下文：handler 按地址和请求体给响应，返回 undefined 当 404。 */
function fakeCtx(
  handler: (url: string, options?: PageOptions) => string | undefined
): SiteContext & { seen: Array<{ url: string; body?: string }> } {
  const seen: Array<{ url: string; body?: string }> = []
  return {
    seen,
    page: async (url, options) => {
      seen.push({ url, body: options?.body })
      return handler(url, options) ?? null
    },
  }
}

const code = (name: string): JavCode => parseJavCode(name)!

describe('DMM cid', () => {
  it('番号 → 数字版 / DVD 版 cid', () => {
    expect(dmmCid('SSIS-497')).toEqual({
      padded: 'ssis00497',
      short: 'ssis497',
    })
    expect(dmmCid('ABP-001')).toEqual({ padded: 'abp00001', short: 'abp001' })
    expect(dmmCid('259LUXU-1234')).toEqual({
      padded: 'luxu01234',
      short: 'luxu1234',
    })
    expect(dmmCid('FC2-PPV-1234567')).toBeUndefined()
  })

  it('检索结果核对：厂商码前缀与版本后缀都认，数字不能多一位', () => {
    const target = dmmCid('STARS-100')!
    expect(sameCid('1stars00100', target)).toBe(true)
    expect(sameCid('stars100', target)).toBe(true)
    expect(sameCid('stars1000', target)).toBe(false)
    expect(pickCid(['stars00100a', '1stars00100', 'stars01000'], target)).toBe(
      '1stars00100'
    )
    expect(pickCid(['ssis00497', 'ssis00497a'], dmmCid('SSIS-497')!)).toBe(
      'ssis00497'
    )
  })

  it('cid → 番号', () => {
    expect(cidToCode('ssis00497')).toBe('SSIS-497')
    expect(cidToCode('h_1133gone00078')).toBe('GONE-078')
    expect(cidToCode('1stars00100')).toBe('STARS-100')
  })
})

describe('DMM GraphQL', () => {
  it('配信日换算成日本时间的日期', () => {
    expect(jstDateOf('Fri 2022-08-19 9:00 AM CST (UTC+08:00)')).toBe(
      '2022-08-19'
    )
    // 日本 0 点上架，在 UTC+8 显示为前一天 23 点
    expect(jstDateOf('Thu 2022-08-18 11:00 PM CST (UTC+08:00)')).toBe(
      '2022-08-19'
    )
    expect(jstDateOf('2022-08-18T15:00:00Z')).toBe('2022-08-19')
    expect(jstDateOf('2022-08-19T00:00:00+09:00')).toBe('2022-08-19')
    expect(jstDateOf('2022-08-19')).toBe('2022-08-19')
  })

  it('详情：全部字段（实抓 SSIS-497）', () => {
    const { content, searchIds } = parseGraphql(fixture('dmm-SSIS-497.json'))
    expect(searchIds).toEqual(['ssis00497'])
    const r = dmmContentRecord(content!)!
    expect(r).toMatchObject({
      site: 'dmm',
      code: 'SSIS-497',
      url: 'https://video.dmm.co.jp/av/content/?id=ssis00497',
      title:
        '最高のオンナ鷲尾めいが人生最高に尽くす一生忘れられない1日限定愛人契約',
      releaseDate: '2022-08-19',
      runtimeMinutes: 120,
      director: '嵐山みちる',
      studio: 'エスワン ナンバーワンスタイル',
      label: 'S1 NO.1 STYLE',
      series: '一生忘れられない1日限定愛人契約',
      cover:
        'https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/ssis00497/ssis00497pl.jpg',
      poster:
        'https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/ssis00497/ssis00497ps.jpg',
      actors: [
        {
          name: '鷲尾めい',
          photo:
            'https://awsimgsrc.dmm.co.jp/pics_dig/mono/actjpgs/wasio_mei.jpg',
        },
      ],
    })
    expect(r.tags).toContain('巨乳')
    expect(r.overview).toMatch(/^「今日だけだから/)
    expect(r.stills).toHaveLength(10)
    expect(r.stills[0]).toBe(
      'https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/ssis00497/ssis00497jp-1.jpg'
    )
  })

  it('查询出错（没有 data）抛错，不当成查无此片', () => {
    expect(() =>
      parseGraphql('{"errors":[{"message":"boom"}],"data":null}')
    ).toThrow(/boom/)
    expect(() => parseGraphql('<html>')).toThrow()
  })
})

describe('DMM 站点流程', () => {
  it('猜中 cid：一次 GraphQL 请求拿全', async () => {
    const ctx = fakeCtx(url =>
      url === DMM_GRAPHQL ? fixture('dmm-SSIS-497.json') : undefined
    )
    const r = await dmm.fetch(code('SSIS-497.mp4'), ctx)
    expect(r?.code).toBe('SSIS-497')
    expect(ctx.seen).toHaveLength(1)
    const body = JSON.parse(ctx.seen[0].body!) as {
      variables: Record<string, unknown>
    }
    expect(body.variables).toEqual({
      id: 'ssis00497',
      word: 'ssis00497',
      floor: 'AV',
    })
  })

  it('带厂商码前缀：检索到 1stars00100 再取详情', async () => {
    const ctx = fakeCtx((_url, options) =>
      options?.body?.includes('JavLookup')
        ? fixture('dmm-STARS-100-lookup.json')
        : fixture('dmm-STARS-100-content.json')
    )
    const r = await dmm.fetch(code('STARS-100.mp4'), ctx)
    expect(r).toMatchObject({
      code: 'STARS-100',
      url: expect.stringContaining('1stars00100'),
    })
    expect(ctx.seen).toHaveLength(2)
  })

  it('GraphQL 没有、网页被地区限制：按查无此片', async () => {
    const ctx = fakeCtx(url =>
      url === DMM_GRAPHQL
        ? fixture('dmm-missing.json')
        : fixture('dmm-region.html')
    )
    expect(await dmm.fetch(code('ZZZZ-999.mp4'), ctx)).toBeNull()
    expect(ctx.seen.map(s => s.url)).toEqual([
      DMM_GRAPHQL,
      'https://www.dmm.co.jp/search/=/searchstr=zzzz999/sort=ranking/',
    ])
  })

  it('GraphQL 失败且网页被拦：抛错（不缓存）', async () => {
    const ctx = fakeCtx(url =>
      url === DMM_GRAPHQL ? '{"data":null}' : fixture('dmm-region.html')
    )
    await expect(dmm.fetch(code('SSIS-497.mp4'), ctx)).rejects.toThrow(
      /GraphQL/
    )
  })

  it('网页兜底：只有 DVD 版的作品', async () => {
    const mono = 'https://www.dmm.co.jp/mono/dvd/-/detail/=/cid=h_068mxgs1234/'
    const ctx = fakeCtx(url => {
      if (url === DMM_GRAPHQL) return fixture('dmm-missing.json')
      if (url.includes('/search/')) return fixture('dmm-web-search-mono.html')
      if (url === mono) return fixture('dmm-mono-MXGS-1234.html')
      return undefined
    })
    const r = await dmm.fetch(code('MXGS-1234.mp4'), ctx)
    expect(r).toMatchObject({ code: 'MXGS-1234', url: mono })
    expect(ctx.seen).toHaveLength(3)
  })

  it('素人番号不走网页兜底', async () => {
    const ctx = fakeCtx(() => fixture('dmm-missing.json'))
    expect(await dmm.fetch(code('259LUXU-1234.mp4'), ctx)).toBeNull()
    expect(ctx.seen).toHaveLength(1)
    expect(JSON.parse(ctx.seen[0].body!).variables.floor).toBeNull()
  })

  it('支持的番号类别', () => {
    expect(dmm.supports('censored')).toBe(true)
    expect(dmm.supports('amateur')).toBe(true)
    expect(dmm.supports('fc2')).toBe(false)
    expect(dmm.supports('uncensored')).toBe(false)
  })
})

describe('DMM 网页解析', () => {
  it('地区限制页（实抓）', () => {
    expect(isRegionBlocked(fixture('dmm-region.html'))).toBe(true)
    expect(() =>
      parseDmmMono(fixture('dmm-region.html'), 'https://www.dmm.co.jp/x')
    ).toThrow(/地区/)
  })

  it('检索页：配信版优先，数字多一位的不要，非视频地址忽略', () => {
    expect(
      pickDmmSearch(fixture('dmm-web-search.html'), dmmCid('SSIS-497')!)
    ).toBe('https://video.dmm.co.jp/av/content/?id=ssis00497')
    expect(
      pickDmmSearch(fixture('dmm-web-search.html'), dmmCid('SSIS-498')!)
    ).toBeUndefined()
  })

  it('DVD 详情页：字段、大图封面、剧照大图', () => {
    const url = 'https://www.dmm.co.jp/mono/dvd/-/detail/=/cid=h_068mxgs1234/'
    const r = parseDmmMono(fixture('dmm-mono-MXGS-1234.html'), url)!
    expect(r).toMatchObject({
      site: 'dmm',
      code: 'MXGS-1234',
      title: 'テスト作品タイトル 由愛可奈',
      releaseDate: '2021-05-13',
      runtimeMinutes: 150,
      studio: 'マキシング',
      label: 'MAXING',
      series: '濃厚シリーズ',
      tags: ['単体作品', '巨乳'],
      actors: [{ name: '由愛可奈' }],
      overview: '人気女優が贈る濃厚な一作。',
      cover:
        'https://pics.dmm.co.jp/mono/movie/adult/h_068mxgs1234/h_068mxgs1234pl.jpg',
      poster:
        'https://pics.dmm.co.jp/mono/movie/adult/h_068mxgs1234/h_068mxgs1234ps.jpg',
      stills: [
        'https://pics.dmm.co.jp/digital/video/h_068mxgs1234/h_068mxgs1234jp-1.jpg',
        'https://pics.dmm.co.jp/digital/video/h_068mxgs1234/h_068mxgs1234jp-2.jpg',
      ],
    })
    expect(r.director).toBeUndefined()
  })
})

describe('DMM 官方 API', () => {
  const auth = { apiId: 'id', affiliateId: 'aff-990' }

  it('凭据只从两个环境变量都有时生效', () => {
    expect(
      credentialsFromEnv({ DMM_API_ID: 'a', DMM_AFFILIATE_ID: 'b-990' })
    ).toEqual({
      apiId: 'a',
      affiliateId: 'b-990',
    })
    expect(credentialsFromEnv({ DMM_API_ID: 'a' })).toBeUndefined()
  })

  it('没配置：不支持任何番号、不发请求', async () => {
    const site = createDmmApi(() => undefined)
    expect(site.supports('censored')).toBe(false)
    const ctx = fakeCtx(() => '{}')
    expect(await site.fetch(code('SSIS-497.mp4'), ctx)).toBeNull()
    expect(ctx.seen).toHaveLength(0)
  })

  it('请求地址', () => {
    const url = new URL(dmmApiUrl(auth, { cid: 'ssis00497' }))
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      api_id: 'id',
      affiliate_id: 'aff-990',
      site: 'FANZA',
      service: 'digital',
      floor: 'videoa',
      cid: 'ssis00497',
      output: 'json',
    })
  })

  it('解析商品（手写响应，未用真实数据验证）', () => {
    const r = dmmApiRecord(parseDmmApi(fixture('dmm-api-SSIS-497.json'))[0])!
    expect(r).toMatchObject({
      site: 'dmm_api',
      code: 'SSIS-497',
      releaseDate: '2022-08-19',
      runtimeMinutes: 120,
      director: '嵐山みちる',
      studio: 'エスワン ナンバーワンスタイル',
      label: 'S1 NO.1 STYLE',
      actors: [{ name: '鷲尾めい' }],
      cover: 'https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497pl.jpg',
      poster: 'https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497ps.jpg',
    })
    expect(r.stills).toHaveLength(2)
  })

  it('接口报错（HTTP 200 + result.status 400，实抓）抛错', () => {
    expect(() => parseDmmApi(fixture('dmm-api-error.json'))).toThrow(/400/)
  })

  it('cid 精确取不到再按番号检索', async () => {
    const site = createDmmApi(() => auth)
    const ctx = fakeCtx(url =>
      url.includes('cid=')
        ? '{"result":{"status":200,"items":[]}}'
        : fixture('dmm-api-SSIS-497.json')
    )
    expect((await site.fetch(code('SSIS-497.mp4'), ctx))?.code).toBe('SSIS-497')
    expect(ctx.seen[1].url).toContain('keyword=SSIS-497')
  })
})
