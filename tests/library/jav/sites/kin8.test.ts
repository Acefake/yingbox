/**
 * 金髪天國（kin8）：番号识别（number.ts 新增规则）、编号补零与越界、详情页解析（真实页面 /movie/3997）、查询流程。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJavCode } from '../../../../src/main/library/providers/jav/number'
import {
  kin8,
  kin8Id,
  parseKin8Detail,
} from '../../../../src/main/library/providers/jav/sites/kin8'
import type { SiteContext } from '../../../../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../../fixtures/jav', name), 'utf8')

const URL_3997 = 'https://www.kin8tengoku.com/movie/3997'

describe('金髪天國番号识别', () => {
  it.each([
    ['KIN8-3997.mp4', 'KIN8-3997'],
    ['kin8-3997.mp4', 'KIN8-3997'],
    ['kin8tengoku_3997.mp4', 'KIN8-3997'],
    ['KIN8TENGOKU-123.mp4', 'KIN8-0123'],
    ['[xx] KIN8 0001 1080p.mp4', 'KIN8-0001'],
  ])('%s → %s', (name, code) => {
    expect(parseJavCode(name)).toMatchObject({ code, kind: 'uncensored' })
  })

  it('KIN8 番号不会被误认成别的番号，别的番号也不会认成 KIN8', () => {
    expect(parseJavCode('SSIS-497.mp4')?.code).toBe('SSIS-497')
    expect(parseJavCode('HEYZO-1234.mp4')?.code).toBe('HEYZO-1234')
    expect(parseJavCode('KIN8-12345.mp4')?.code ?? '').not.toMatch(/^KIN8-/)
  })
})

describe('金髪天國站点', () => {
  it.each([
    ['KIN8-1', '0001'],
    ['KIN8-0001', '0001'],
    ['KIN8TENGOKU-123', '0123'],
    ['KIN8-3997', '3997'],
    ['KIN8-0', undefined],
    ['KIN8-0000', undefined],
    ['KIN8-10000', undefined],
    ['HEYZO-1234', undefined],
    ['0001', undefined],
  ])('编号 %s → %s', (code, id) => {
    expect(kin8Id(code)).toBe(id)
  })

  it('详情页：全部字段', () => {
    const r = parseKin8Detail(fixture('kin8-3997.html'), URL_3997, '3997')!
    expect(r).toMatchObject({
      site: 'kin8',
      code: 'KIN8-3997',
      url: URL_3997,
      title:
        'KIN8 SHARED HOUSE 金8シェアハウスは無法地帯、今日も男女が乱れ狂う 新入居者 Pola',
      releaseDate: '2025-02-06',
      runtimeMinutes: 36,
      studio: '金髪天國',
      actors: [{ name: 'ポーラ' }],
      cover: 'https://www.kin8tengoku.com/3997/pht/1.jpg',
    })
    expect(r.tags).toContain('フェラチオ')
    expect(r.tags).toHaveLength(11)
    expect(r.overview).toMatch(/^ポーラちゃんは最近新しいシェアハウス/)
  })

  it('没有标题的页面返回 null', () => {
    expect(parseKin8Detail('<html></html>', URL_3997, '3997')).toBeNull()
  })

  it('查询：直取 /movie/<4 位编号>；非本站番号不发请求', async () => {
    const seen: string[] = []
    const ctx: SiteContext = {
      page: async url => {
        seen.push(url)
        return url === URL_3997 ? fixture('kin8-3997.html') : null
      },
    }
    const hit = await kin8.fetch(
      { code: 'KIN8-3997', kind: 'uncensored', subtitle: false },
      ctx
    )
    expect(hit?.actors).toEqual([{ name: 'ポーラ' }])
    const miss = await kin8.fetch(
      { code: 'HEYZO-1234', kind: 'uncensored', subtitle: false },
      ctx
    )
    expect(miss).toBeNull()
    expect(seen).toEqual([URL_3997])
    expect(kin8.supports('uncensored')).toBe(true)
    expect(kin8.supports('censored')).toBe(false)
  })
})
