/**
 * JavDB：搜索卡片核对、详情页字段、演员头像拼接、Cookie 与 FC2 开关。
 * 录制页面来自 web.archive.org（沙箱直连 javdb.com 被 Cloudflare 拦截）：
 * javdb-SSIS-133（2026-01）、javdb-FIR-004（2025-05）详情页；javdb-search 是 /video_codes 列表页，
 * 卡片结构与搜索结果相同。
 */
import { describe, expect, it } from 'vitest'
import { parseJavCode } from '../src/main/library/providers/jav/number'
import {
  createJavdb,
  javdb,
  javdbAvatar,
  javdbSearchUrl,
  parseJavdbDetail,
  pickJavdbSearch,
} from '../src/main/library/providers/jav/sites/javdb'
import { fixture, pages } from './jav-site-helpers'

describe('JavDB 解析', () => {
  it('详情页：全部字段，只取女优，头像按演员 id 拼', () => {
    const r = parseJavdbDetail(
      fixture('javdb-SSIS-133.html'),
      'https://javdb.com/v/005Qa'
    )!
    expect(r).toMatchObject({
      site: 'javdb',
      code: 'SSIS-133',
      url: 'https://javdb.com/v/005Qa',
      title:
        '同期なのに●っ払うとキス魔になっちゃう私は嫌い？ miru （ブルーレイディスク）',
      releaseDate: '2021-08-07',
      runtimeMinutes: 120,
      director: '朝霧浄',
      studio: 'S1 NO.1 STYLE',
      cover: 'https://c0.jdbstatic.com/covers/00/005Qa.jpg',
    })
    expect(r.tags).toContain('單體作品')
    // 男优（♂ 結城結弦）不算
    expect(r.actors).toEqual([
      {
        name: '坂道みる',
        photo: 'https://c0.jdbstatic.com/avatars/vd/vd5z.jpg',
      },
    ])
    expect(r.stills).toHaveLength(10)
    expect(r.stills[0]).toBe(
      'https://c0.jdbstatic.com/samples/00/005Qa_l_0.jpg'
    )
  })

  it('多位女优', () => {
    const r = parseJavdbDetail(
      fixture('javdb-FIR-004.html'),
      'https://javdb.com/v/00d87'
    )!
    expect(r.code).toBe('FIR-004')
    expect(r.actors.map(a => a.name)).toContain('涼森れむ')
    expect(
      r.actors.every(a =>
        a.photo?.startsWith('https://c0.jdbstatic.com/avatars/')
      )
    ).toBe(true)
  })

  it('头像地址：id 前两位小写做目录', () => {
    expect(javdbAvatar('/actors/O2Q30')).toBe(
      'https://c0.jdbstatic.com/avatars/o2/O2Q30.jpg'
    )
    expect(javdbAvatar('/makers/7R')).toBeUndefined()
  })

  it('不是详情页返回 null', () => {
    expect(
      parseJavdbDetail(fixture('javdb-search.html'), 'https://javdb.com/x')
    ).toBeNull()
  })

  it('搜索卡片：分隔符不同也认（站上无码日期型写下划线）', () => {
    const html = fixture('javdb-search.html')
    expect(pickJavdbSearch(html, '020625-001')).toBe(
      'https://javdb.com/v/4D6kRv'
    )
    expect(pickJavdbSearch(html, '020625_001')).toBe(
      'https://javdb.com/v/4D6kRv'
    )
    expect(pickJavdbSearch(html, '020625-002')).toBeUndefined()
  })

  it('同番号多条且写法都不完全一致时放弃', () => {
    const card = (id: string, code: string): string =>
      `<a href="/v/${id}" class="box"><div class="video-title"><strong>${code}</strong> t</div></a>`
    const html = `<div class="movie-list">${card('a', 'ABC_123')}${card('b', 'ABC 123')}</div>`
    expect(pickJavdbSearch(html, 'ABC-123')).toBeUndefined()
    const exact = `<div>${card('a', 'ABC-123')}${card('b', 'ABC_123')}</div>`
    expect(pickJavdbSearch(exact, 'ABC-123')).toBe('https://javdb.com/v/a')
  })
})

describe('JavDB 站点', () => {
  it('搜索 → 详情，两次请求，带年龄确认 Cookie', async () => {
    const ctx = pages({
      [javdbSearchUrl('020625-001')]: fixture('javdb-search.html'),
      'https://javdb.com/v/4D6kRv': fixture('javdb-SSIS-133.html'),
    })
    const r = await javdb.fetch(parseJavCode('020625-001.mp4')!, ctx)
    expect(r?.url).toBe('https://javdb.com/v/4D6kRv')
    expect(ctx.seen.map(s => s.url)).toEqual([
      'https://javdb.com/search?q=020625-001&f=all&locale=zh',
      'https://javdb.com/v/4D6kRv',
    ])
    expect(ctx.seen[0].options?.cookie).toBe('over18=1; locale=zh')
  })

  it('搜索没命中不取详情', async () => {
    const ctx = pages({
      [javdbSearchUrl('SSIS-497')]: fixture('javdb-search.html'),
    })
    expect(await javdb.fetch(parseJavCode('SSIS-497')!, ctx)).toBeNull()
    expect(ctx.seen).toHaveLength(1)
  })

  it('FC2 只在配置了登录 Cookie 时查；Cookie 拼在固定 Cookie 后面', async () => {
    expect(javdb.supports('fc2')).toBe(false)
    expect(javdb.supports('censored')).toBe(true)
    let cookie: string | undefined = '  '
    const site = createJavdb({ cookie: () => cookie })
    expect(site.supports('fc2')).toBe(false)
    cookie = '_jdb_session=abc'
    expect(site.supports('fc2')).toBe(true)
    const ctx = pages({})
    await site.fetch(parseJavCode('FC2-PPV-3662771')!, ctx)
    expect(ctx.seen[0].options?.cookie).toBe(
      'over18=1; locale=zh; _jdb_session=abc'
    )
  })
})
