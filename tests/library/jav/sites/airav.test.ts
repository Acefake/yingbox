/**
 * AIRAV：用录制的真实页面（tests/fixtures/jav/airav-*，已去掉脚本与样式）验证搜索核对、详情解析与查询流程。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJavCode } from '../../../../src/main/library/providers/jav/number'
import {
  airav,
  parseAiravDetail,
  pickAiravSearch,
} from '../../../../src/main/library/providers/jav/sites/airav'
import type { SiteContext } from '../../../../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../../fixtures/jav', name), 'utf8')

const DETAIL = 'https://airav.io/video?hid=99-21-57873'

describe('AIRAV', () => {
  it('搜索结果：标题开头的番号对得上才算', () => {
    expect(pickAiravSearch(fixture('airav-search.html'), 'SSIS-497')).toBe(
      DETAIL
    )
    expect(
      pickAiravSearch(fixture('airav-search.html'), 'SSIS-49')
    ).toBeUndefined()
    expect(
      pickAiravSearch(fixture('airav-search-empty.html'), 'NOTEXIST-999')
    ).toBeUndefined()
  })

  it('日期型无码：站上写作 caribbeancom010120-001 也认', () => {
    expect(
      pickAiravSearch(fixture('airav-search-carib.html'), '010120-001')
    ).toBe('https://airav.io/video?hid=99-07-18577')
  })

  it('详情页：字段，去掉画质 / 字幕标记类别', () => {
    const r = parseAiravDetail(fixture('airav-SSIS-497.html'), DETAIL)!
    expect(r).toMatchObject({
      site: 'airav',
      code: 'SSIS-497',
      title: '與最棒女性鷲尾芽衣進行人生最棒一生無法忘懷的1日限定愛人契約',
      releaseDate: '2022-08-23',
      studio: 'エスワン',
      actors: [{ name: '鷲尾芽衣' }],
      cover: 'https://airav.io/storage/cover/big/99-21-57873.jpg',
      stills: [],
    })
    expect(r.tags).toContain('巨乳')
    expect(r.tags).not.toContain('720p')
    expect(r.tags).not.toContain('HD高畫質')
    expect(r.tags).not.toContain('中文')
    expect(r.overview).toMatch(/^「只有今天哦」/)
    expect(r.runtimeMinutes).toBeUndefined()
  })

  it('不是详情页返回 null', () => {
    expect(parseAiravDetail(fixture('airav-search.html'), DETAIL)).toBeNull()
  })

  it('查询流程：搜索 → 详情；搜不到不再发请求；不查 FC2', async () => {
    const seen: string[] = []
    const map: Record<string, string> = {
      'https://airav.io/search_result?kw=SSIS-497':
        fixture('airav-search.html'),
      [DETAIL]: fixture('airav-SSIS-497.html'),
    }
    const ctx: SiteContext = {
      page: async url => {
        seen.push(url)
        return map[url] ?? null
      },
    }
    expect((await airav.fetch(parseJavCode('SSIS-497.mp4')!, ctx))?.code).toBe(
      'SSIS-497'
    )
    expect(seen).toHaveLength(2)
    expect(await airav.fetch(parseJavCode('ABP-123.mp4')!, ctx)).toBeNull()
    expect(seen).toHaveLength(3)
    expect(airav.supports('fc2')).toBe(false)
    expect(airav.supports('uncensored')).toBe(true)
  })
})

describe('AIRAV 番号写法', () => {
  it('详情页番号带厂牌前缀时记为常规写法', () => {
    const html = fixture('airav-SSIS-497.html')
      .replace('<span>SSIS-497</span>', '<span>caribbeancom010120-001</span>')
      .replace('<h1>SSIS-497 ', '<h1>caribbeancom010120-001 ')
    const r = parseAiravDetail(html, DETAIL)!
    expect(r.code).toBe('010120-001')
    expect(r.title).toBe(
      '與最棒女性鷲尾芽衣進行人生最棒一生無法忘懷的1日限定愛人契約'
    )
  })
})
