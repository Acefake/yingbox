/**
 * FreeJavBT：用录制的真实页面（tests/fixtures/jav/freejavbt-*，已去掉脚本与样式）验证解析，
 * 以及查询流程（直取 → 素人去前缀 → 搜索回退）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJavCode } from '../src/main/library/providers/jav/number'
import {
  freejavbt,
  freejavbtCandidates,
  parseFreejavbtDetail,
  pickFreejavbtSearch,
} from '../src/main/library/providers/jav/sites/freejavbt'
import type { SiteContext } from '../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures/jav', name), 'utf8')

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

describe('FreeJavBT 解析', () => {
  it('有码详情页：字段与剧照', () => {
    const r = parseFreejavbtDetail(
      fixture('freejavbt-SSIS-497.html'),
      'https://freejavbt.com/SSIS-497'
    )!
    expect(r).toMatchObject({
      site: 'freejavbt',
      code: 'SSIS-497',
      title: '鷲尾芽衣讓你達到人生最高潮 一輩子忘不掉的1日限定情人 鷲尾芽衣',
      runtimeMinutes: 120,
      director: '嵐山みちる',
      series: '一生忘れられない1日限定愛人契約',
      tags: ['巨乳', '淫亂，真實', '出軌', '薄馬賽克', '4K', '單體作品'],
      cover:
        'https://fmtu.sl2025p.com/upload/vod/20230206-1/b83daa1e9e01ceef9e9078ae0837048a.jpg',
    })
    expect(r.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(r.actors.map(a => a.name)).toEqual(['芦田陽', '筧ジュン'])
    expect(r.stills).toHaveLength(10)
    expect(r.stills[0]).toBe(
      'https://c0.jdbstatic.com/samples/gm/GMZadJ_l_0.jpg'
    )
  })

  it('FC2 详情页：番号写作 FC2-<数字>，演员占位不算演员', () => {
    const r = parseFreejavbtDetail(
      fixture('freejavbt-FC2-3662771.html'),
      'https://freejavbt.com/FC2-3662771'
    )!
    expect(r).toMatchObject({
      code: 'FC2-3662771',
      title: '【豊満巨乳のスナックママメイン版】',
      releaseDate: '2023-09-02',
      runtimeMinutes: 52,
      actors: [],
    })
  })

  it('查无此片的推荐页返回 null', () => {
    expect(
      parseFreejavbtDetail(
        fixture('freejavbt-missing.html'),
        'https://freejavbt.com/x'
      )
    ).toBeNull()
  })

  it('搜索结果：跳过广告外链，按链接末段核对番号', () => {
    const html = fixture('freejavbt-search.html')
    expect(pickFreejavbtSearch(html, 'SSIS-497')).toBe(
      'https://freejavbt.com/SSIS-497'
    )
    expect(pickFreejavbtSearch(html, 'SSIS-498')).toBeUndefined()
  })

  it('直取写法：FC2 去掉 PPV，素人多试去前缀', () => {
    expect(freejavbtCandidates(parseJavCode('FC2-PPV-3662771.mp4')!)).toEqual([
      'FC2-3662771',
    ])
    expect(freejavbtCandidates(parseJavCode('259LUXU-1234.mp4')!)).toEqual([
      '259LUXU-1234',
      'LUXU-1234',
    ])
    expect(freejavbtCandidates(parseJavCode('SSIS-497.mp4')!)).toEqual([
      'SSIS-497',
    ])
  })
})

describe('FreeJavBT 查询流程', () => {
  it('直取命中只发一次请求', async () => {
    const ctx = pages({
      'https://freejavbt.com/SSIS-497': fixture('freejavbt-SSIS-497.html'),
    })
    const r = await freejavbt.fetch(parseJavCode('SSIS-497.mp4')!, ctx)
    expect(r?.code).toBe('SSIS-497')
    expect(ctx.seen).toHaveLength(1)
  })

  it('FC2 直取 /FC2-<数字>', async () => {
    const ctx = pages({
      'https://freejavbt.com/FC2-3662771': fixture(
        'freejavbt-FC2-3662771.html'
      ),
    })
    const r = await freejavbt.fetch(parseJavCode('FC2-PPV-3662771.mp4')!, ctx)
    expect(r?.code).toBe('FC2-3662771')
  })

  it('直取是推荐页时走搜索；搜索给回同一地址不重复取', async () => {
    const ctx = pages({
      'https://freejavbt.com/SSIS-497': fixture('freejavbt-missing.html'),
      'https://freejavbt.com/search/SSIS-497': fixture('freejavbt-search.html'),
    })
    expect(await freejavbt.fetch(parseJavCode('SSIS-497.mp4')!, ctx)).toBeNull()
    expect(ctx.seen).toEqual([
      'https://freejavbt.com/SSIS-497',
      'https://freejavbt.com/search/SSIS-497',
    ])
  })

  it('页面番号与要找的不一致按没有处理', async () => {
    const ctx = pages({
      'https://freejavbt.com/SSIS-498': fixture('freejavbt-SSIS-497.html'),
    })
    expect(await freejavbt.fetch(parseJavCode('SSIS-498.mp4')!, ctx)).toBeNull()
  })

  it('支持全部番号类别', () => {
    for (const kind of ['censored', 'uncensored', 'fc2', 'amateur'] as const)
      expect(freejavbt.supports(kind)).toBe(true)
  })
})
