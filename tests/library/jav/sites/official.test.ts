/**
 * 厂商官网（official）：路由表、详情页解析（真实页面 s1s1s1.com/works/detail/ssis497）、
 * 404 页与番号不符时按没有处理、不在路由表的番号不发请求。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OFFICIAL_MAKERS,
  makerOf,
} from '../../../../src/main/library/providers/jav/sites/official-makers'
import {
  official,
  officialUrl,
  parseOfficialDetail,
} from '../../../../src/main/library/providers/jav/sites/official'
import type { SiteContext } from '../../../../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../../fixtures/jav', name), 'utf8')

/** 按 URL 返回页面的假上下文；没登记的地址当 404。 */
function pages(map: Record<string, string>): SiteContext & { seen: string[] } {
  const seen: string[] = []
  return {
    seen,
    page: async url => {
      seen.push(url)
      return map[url] ?? null
    },
  }
}

const URL_497 = 'https://s1s1s1.com/works/detail/ssis497'

describe('official 路由表', () => {
  it.each([
    ['SSIS-497', 's1s1s1.com'],
    ['MIDV-018', 'moodyz.com'],
    ['IPX-177', 'ideapocket.com'],
    ['JUL-100', 'www.madonna-av.com'],
    ['HUNTB-100', 'hhh-av.com'],
    ['HUNT-100', 'hhh-av.com'],
  ])('%s → %s', (code, domain) => {
    expect(makerOf(code)?.domain).toBe(domain)
  })

  it('不在表里的前缀返回 undefined', () => {
    expect(makerOf('ABW-350')).toBeUndefined()
    expect(officialUrl('ABW-350')).toBeUndefined()
  })

  it('前缀在表里不重复', () => {
    const all = OFFICIAL_MAKERS.flatMap(m => m.prefixes.split(/\s+/))
    expect(new Set(all).size).toBe(all.length)
  })

  it('详情页地址：小写去横线', () => {
    expect(officialUrl('SSIS-497')).toBe(URL_497)
  })
})

describe('official 详情页', () => {
  it('真实页面：全部字段', () => {
    const r = parseOfficialDetail(
      fixture('official-SSIS-497.html'),
      URL_497,
      'SSIS-497'
    )!
    expect(r).toMatchObject({
      site: 'official',
      code: 'SSIS-497',
      url: URL_497,
      title:
        '最高のオンナ鷲尾めいが人生最高に尽くす一生忘れられない1日限定愛人契約',
      releaseDate: '2022-08-23',
      runtimeMinutes: 120,
      director: '嵐山みちる',
      studio: 'S1 NO.1 STYLE',
      tags: ['巨乳', 'ホテル', '単体作品', '淫乱・ハード系', '不倫'],
      actors: [{ name: '鷲尾めい' }],
      cover:
        'https://cdn.up-timely.com/image/2/content/60412/cJgMKCJZnko14seBPFHwI8JsBYgw5FTEoZ1ZiM8c.jpg',
    })
    expect(r.series).toBeUndefined()
    expect(r.poster).toBeUndefined()
    expect(r.overview).toMatch(/^「今日だけだから…ね？」/)
    expect(r.stills).toHaveLength(10)
    expect(r.stills).not.toContain(r.cover)
  })

  it('404 页（站点回 200）按没有处理', () => {
    expect(
      parseOfficialDetail(fixture('official-missing.html'), URL_497, 'SSIS-497')
    ).toBeNull()
  })

  it('页面品番与查询番号不符按没有处理', () => {
    expect(
      parseOfficialDetail(
        fixture('official-SSIS-497.html'),
        URL_497,
        'SSIS-498'
      )
    ).toBeNull()
  })
})

describe('official 查询流程', () => {
  it('路由到官网直取详情页，一次请求', async () => {
    const ctx = pages({ [URL_497]: fixture('official-SSIS-497.html') })
    const r = await official.fetch(
      { code: 'SSIS-497', kind: 'censored', subtitle: false },
      ctx
    )
    expect(r?.title).toMatch(/鷲尾めい/)
    expect(ctx.seen).toEqual([URL_497])
  })

  it('不在路由表的番号不发请求', async () => {
    const ctx = pages({})
    const r = await official.fetch(
      { code: 'ABW-350', kind: 'censored', subtitle: false },
      ctx
    )
    expect(r).toBeNull()
    expect(ctx.seen).toEqual([])
  })

  it('只查有码', () => {
    expect(official.supports('censored')).toBe(true)
    expect(official.supports('uncensored')).toBe(false)
    expect(official.supports('fc2')).toBe(false)
  })
})
