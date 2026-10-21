/**
 * MGS 動画：详情页解析与查询流程。详情 / 检索页为手写结构（地区限制抓不到，未用真实页面验证），
 * 成人确认页为 Wayback 存档的真实页面。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJavCode } from '../src/main/library/providers/jav/number'
import {
  mgstage,
  mgstageDetailUrl,
  parseMgstageDetail,
  pickMgstageSearch,
} from '../src/main/library/providers/jav/sites/mgstage'
import type { SiteContext } from '../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures/jav', name), 'utf8')

function pages(map: Record<string, string>): SiteContext & { seen: string[] } {
  const seen: string[] = []
  return {
    seen,
    page: async (url, options) => {
      expect(options?.cookie).toContain('adc=1')
      seen.push(url)
      return map[url] ?? null
    },
  }
}

const DETAIL = 'https://www.mgstage.com/product/product_detail/259LUXU-1234/'

describe('MGS 動画', () => {
  it('详情页：全部字段', () => {
    const r = parseMgstageDetail(fixture('mgstage-259LUXU-1234.html'), DETAIL)!
    expect(r).toMatchObject({
      site: 'mgstage',
      code: '259LUXU-1234',
      url: DETAIL,
      title: 'ラグジュTV 1234 上品な人妻が見せる大胆な素顔',
      releaseDate: '2020-03-04',
      runtimeMinutes: 72,
      studio: 'ラグジュTV',
      label: 'ラグジュTV',
      series: 'ラグジュTV',
      tags: ['人妻', '素人', '配信専用'],
      actors: [{ name: 'みお 30歳 主婦' }],
      overview:
        '結婚5年目の上品な奥様が登場。普段は見せない大胆な一面を披露します。',
      cover:
        'https://image.mgstage.com/images/luxutv/259luxu/1234/pb_e_259luxu-1234.jpg',
      poster:
        'https://image.mgstage.com/images/luxutv/259luxu/1234/pf_o1_259luxu-1234.jpg',
      stills: [
        'https://image.mgstage.com/images/luxutv/259luxu/1234/cap_e_0_259luxu-1234.jpg',
        'https://image.mgstage.com/images/luxutv/259luxu/1234/cap_e_1_259luxu-1234.jpg',
      ],
    })
  })

  it('成人确认页（真实存档）抛错，不当成查无此片', () => {
    expect(() =>
      parseMgstageDetail(fixture('mgstage-agegate.html'), DETAIL)
    ).toThrow(/成人确认/)
  })

  it('不是详情页返回 null', () => {
    expect(
      parseMgstageDetail(
        '<div id="center_column"><h1>トップ</h1></div>',
        DETAIL
      )
    ).toBeNull()
  })

  it('检索：去掉数字前缀核对，数字多一位的不要', () => {
    expect(pickMgstageSearch(fixture('mgstage-search.html'), 'LUXU-1234')).toBe(
      DETAIL
    )
    expect(
      pickMgstageSearch(fixture('mgstage-search.html'), 'LUXU-123')
    ).toBeUndefined()
  })

  it('素人番号缺前缀：直取失败后检索', async () => {
    const ctx = pages({
      [mgstageDetailUrl('LUXU-1234')]: '<html><title>MGS</title></html>',
      'https://www.mgstage.com/search/cSearch.php?search_word=LUXU-1234&type=top':
        fixture('mgstage-search.html'),
      [DETAIL]: fixture('mgstage-259LUXU-1234.html'),
    })
    const target = {
      code: 'LUXU-1234',
      kind: 'amateur' as const,
      subtitle: false,
    }
    expect((await mgstage.fetch(target, ctx))?.code).toBe('259LUXU-1234')
    expect(ctx.seen).toHaveLength(3)
  })

  it('有码只直取一次', async () => {
    const ctx = pages({})
    expect(await mgstage.fetch(parseJavCode('ABW-001.mp4')!, ctx)).toBeNull()
    expect(ctx.seen).toEqual([mgstageDetailUrl('ABW-001')])
  })

  it('支持的番号类别', () => {
    expect(mgstage.supports('amateur')).toBe(true)
    expect(mgstage.supports('censored')).toBe(true)
    expect(mgstage.supports('fc2')).toBe(false)
  })
})
