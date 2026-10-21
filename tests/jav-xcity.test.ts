/**
 * XCITY：检索页（真实页面 q=STARS874）、详情页（真实页面 /avod/detail/?id=184340）、
 * 品番核对、查询流程（检索 → 逐条核对，带 Referer 与年龄 Cookie）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseXcityDetail,
  parseXcitySearch,
  xcity,
  xcitySearchUrl,
} from '../src/main/library/providers/jav/sites/xcity'
import type {
  PageOptions,
  SiteContext,
} from '../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures/jav', name), 'utf8')

const SEARCH = 'https://xcity.jp/result_published/?q=STARS874&sg=main&num=30'
const DETAIL = 'https://xcity.jp/avod/detail/?id=184340'
const STARS = { code: 'STARS-874', kind: 'censored', subtitle: false } as const

/** 按 URL 返回页面的假上下文；没登记的地址当 404。 */
function pages(
  map: Record<string, string>
): SiteContext & { seen: string[]; options: Array<PageOptions | undefined> } {
  const seen: string[] = []
  const options: Array<PageOptions | undefined> = []
  return {
    seen,
    options,
    page: async (url, opts) => {
      seen.push(url)
      options.push(opts)
      return map[url] ?? null
    },
  }
}

describe('XCITY', () => {
  it('检索地址：番号去横线', () => {
    expect(xcitySearchUrl('STARS-874')).toBe(SEARCH)
  })

  it('检索页：结果表里的详情链接；零结果为空', () => {
    expect(parseXcitySearch(fixture('xcity-search-STARS-874.html'))).toEqual([
      DETAIL,
    ])
    expect(parseXcitySearch(fixture('xcity-search-empty.html'))).toEqual([])
  })

  it('详情页：全部字段', () => {
    const r = parseXcityDetail(
      fixture('xcity-STARS-874.html'),
      DETAIL,
      'STARS-874'
    )!
    expect(r).toMatchObject({
      site: 'xcity',
      code: 'STARS-874',
      url: DETAIL,
      releaseDate: '2023-08-24',
      runtimeMinutes: 140,
      director: 'うさぴょん。',
      studio: 'SOD / ソフト・オン・デマンド',
      label: 'SOD STAR',
      series: 'とろだく漏らしっぱなし性交',
      actors: [{ name: '小湊よつ葉' }],
      cover:
        'https://faws.xcity.jp/package-b/large/image/maker/sod/stars874/b_1709866091_1.jpg',
      poster:
        'https://faws.xcity.jp/package/medium/image/maker/sod/stars874/f_1709866087_1.jpg',
    })
    expect(r.title).toMatch(/^【夏といえば水着！SODstar全員ビキニ祭】/)
    expect(r.tags).toContain('単体作品')
    expect(r.overview).toMatch(/^一か月間に渡る禁欲生活/)
  })

  it('品番不符按没有处理', () => {
    expect(
      parseXcityDetail(fixture('xcity-STARS-874.html'), DETAIL, 'STARS-875')
    ).toBeNull()
  })

  it('查询：检索 → 详情，带 Referer 与 adc Cookie', async () => {
    const ctx = pages({
      [SEARCH]: fixture('xcity-search-STARS-874.html'),
      [DETAIL]: fixture('xcity-STARS-874.html'),
    })
    expect((await xcity.fetch(STARS, ctx))?.label).toBe('SOD STAR')
    expect(ctx.seen).toEqual([SEARCH, DETAIL])
    for (const opts of ctx.options) {
      expect(opts?.cookie).toBe('adc=1')
      expect(opts?.headers?.Referer).toBe('https://xcity.jp/')
    }
  })

  it('零结果：只发检索一次', async () => {
    const ctx = pages({ [SEARCH]: fixture('xcity-search-empty.html') })
    expect(await xcity.fetch(STARS, ctx)).toBeNull()
    expect(ctx.seen).toEqual([SEARCH])
  })
})
