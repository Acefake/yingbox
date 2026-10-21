/**
 * iQQTV：用录制的真实页面（tests/fixtures/jav/iqqtv-*，已去掉脚本与样式）验证搜索核对（含片长）、详情解析与查询流程。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJavCode } from '../src/main/library/providers/jav/number'
import {
  iqqtv,
  parseIqqtvDetail,
  pickIqqtvSearch,
} from '../src/main/library/providers/jav/sites/iqqtv'
import type { SiteContext } from '../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures/jav', name), 'utf8')

const DETAIL = 'https://iqq5.xyz/cn/player.php?uuid=3iHjPe5oG4v&cat=19'

describe('iQQTV', () => {
  it('搜索结果：番号是标题里的独立词，片长取条目上的秒数', () => {
    expect(pickIqqtvSearch(fixture('iqqtv-search.html'), 'SSIS-497')).toEqual({
      url: DETAIL,
      runtimeMinutes: 120,
    })
    expect(
      pickIqqtvSearch(fixture('iqqtv-search-empty.html'), 'NOTEXIST-999')
    ).toBeUndefined()
  })

  it('日期型无码：站上写作 caribbeancom010120-001 也认', () => {
    expect(
      pickIqqtvSearch(fixture('iqqtv-search-carib.html'), '010120-001')
    ).toEqual({
      url: 'https://iqq5.xyz/cn/player.php?uuid=c2ROUim1K6V&cat=19',
      runtimeMinutes: 59,
    })
  })

  it('破坏版条目跳过', () => {
    const html = fixture('iqqtv-search.html').replace(
      /title="与最棒女性/g,
      'title="【无码破解】与最棒女性'
    )
    expect(pickIqqtvSearch(html, 'SSIS-497')).toBeUndefined()
  })

  it('详情页：字段只取影片信息区，去掉站点标记类别', () => {
    const r = parseIqqtvDetail(fixture('iqqtv-SSIS-497.html'), DETAIL, 120)!
    expect(r).toMatchObject({
      site: 'iqqtv',
      code: 'SSIS-497',
      title: '与最棒女性鹫尾芽衣进行人生最棒一生无法忘怀的1日限定爱人契约',
      releaseDate: '2022-08-23',
      runtimeMinutes: 120,
      studio: 'S1 Style',
      series: '一生无法忘怀仅限一日爱人契约',
      actors: [{ name: '鹫尾芽衣' }],
      cover: 'https://iqqq5.work/preview/80/b/3iHjPe5oG4v-800.jpg?v=1790645376',
      stills: [],
    })
    expect(r.tags).toEqual([
      'AV女优片',
      '巨乳',
      '不伦',
      '淫乱',
      'ホテル',
      'winter',
    ])
    expect(r.overview).toMatch(/^「只有今天哦」/)
    expect(r.overview).not.toMatch(/简介/)
  })

  it('查询流程：搜索 → 详情，片长从搜索带过去', async () => {
    const seen: string[] = []
    const map: Record<string, string> = {
      'https://iqq5.xyz/cn/search.php?kw=SSIS-497':
        fixture('iqqtv-search.html'),
      [DETAIL]: fixture('iqqtv-SSIS-497.html'),
    }
    const ctx: SiteContext = {
      page: async url => {
        seen.push(url)
        return map[url] ?? null
      },
    }
    const r = await iqqtv.fetch(parseJavCode('SSIS-497.mp4')!, ctx)
    expect(r?.runtimeMinutes).toBe(120)
    expect(seen).toHaveLength(2)
    expect(await iqqtv.fetch(parseJavCode('ABP-123.mp4')!, ctx)).toBeNull()
    expect(iqqtv.supports('fc2')).toBe(false)
  })
})
