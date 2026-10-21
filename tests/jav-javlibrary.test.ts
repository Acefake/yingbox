/**
 * JAVLibrary：识别码搜索（列表 / 直接跳详情）、详情页字段、语言版本。
 * 录制页面来自 web.archive.org 2024 年的快照（沙箱直连被 Cloudflare 拦截）。
 */
import { describe, expect, it } from 'vitest'
import { parseJavCode } from '../src/main/library/providers/jav/number'
import {
  createJavlibrary,
  isJavlibraryDetail,
  javlibrary,
  javlibrarySearchUrl,
  parseJavlibraryDetail,
  pickJavlibrarySearch,
} from '../src/main/library/providers/jav/sites/javlibrary'
import { fixture, pages } from './jav-site-helpers'

describe('JAVLibrary 解析', () => {
  it('详情页：字段按 id 取，标题去掉识别码与末尾演员名，地址取 canonical', () => {
    const r = parseJavlibraryDetail(
      fixture('javlibrary-ADN-162.html'),
      javlibrarySearchUrl('ADN-162')
    )!
    expect(r).toEqual({
      site: 'javlibrary',
      code: 'ADN-162',
      url: 'https://www.javlibrary.com/cn/?v=javli436zi',
      title: '肉体奉公 人妻家政婦、犯されるままに',
      releaseDate: '2018-04-07',
      runtimeMinutes: 110,
      director: '一磨',
      studio: 'Attackers',
      label: '大人のドラマ',
      tags: ['单体作品', '巨乳', '已婚妇女', '凌辱', '戏剧'],
      actors: [{ name: '松下紗栄子' }],
      cover: 'https://pics.dmm.co.jp/mono/movie/adult/adn162/adn162pl.jpg',
      stills: [],
    })
  })

  it('分辨详情页与列表页', () => {
    expect(isJavlibraryDetail(fixture('javlibrary-ADN-162.html'))).toBe(true)
    expect(isJavlibraryDetail(fixture('javlibrary-search-CKD-02.html'))).toBe(
      false
    )
  })

  it('列表：唯一对得上的那条；同识别码多部片时放弃', () => {
    const html = fixture('javlibrary-search-CKD-02.html')
    const base = javlibrarySearchUrl('CKD-02')
    expect(pickJavlibrarySearch(html, 'CKD-021', base)).toBe(
      'https://www.javlibrary.com/cn/?v=javlimtnze'
    )
    // CKD-02 在站上有两部（不同厂牌）
    expect(pickJavlibrarySearch(html, 'CKD-02', base)).toBeUndefined()
    expect(
      pickJavlibrarySearch(fixture('javlibrary-search-empty.html'), 'X-1', base)
    ).toBeUndefined()
  })
})

describe('JAVLibrary 站点', () => {
  it('搜索直接跳到详情：一次请求', async () => {
    const ctx = pages({
      [javlibrarySearchUrl('ADN-162')]: fixture('javlibrary-ADN-162.html'),
    })
    const r = await javlibrary.fetch(parseJavCode('ADN-162')!, ctx)
    expect(r?.url).toBe('https://www.javlibrary.com/cn/?v=javli436zi')
    expect(ctx.seen).toHaveLength(1)
    expect(ctx.seen[0].options?.cookie).toBe('over18=18')
  })

  it('跳转到的详情番号对不上按没有处理', async () => {
    const ctx = pages({
      [javlibrarySearchUrl('ADN-016')]: fixture('javlibrary-ADN-162.html'),
    })
    expect(await javlibrary.fetch(parseJavCode('ADN-016')!, ctx)).toBeNull()
  })

  it('列表 → 详情；语言版本进 URL', async () => {
    const site = createJavlibrary({ language: 'ja' })
    const ctx = pages({
      'https://www.javlibrary.com/ja/vl_searchbyid.php?keyword=CKD-021':
        fixture('javlibrary-search-CKD-02.html'),
      'https://www.javlibrary.com/ja/?v=javlimtnze': fixture(
        'javlibrary-ADN-162.html'
      ),
    })
    const r = await site.fetch(parseJavCode('CKD-021')!, ctx)
    expect(ctx.seen.map(s => s.url)).toEqual([
      'https://www.javlibrary.com/ja/vl_searchbyid.php?keyword=CKD-021',
      'https://www.javlibrary.com/ja/?v=javlimtnze',
    ])
    expect(ctx.seen[0].options?.headers?.['Accept-Language']).toMatch(/^ja/)
    expect(r).not.toBeNull()
  })

  it('只查有码', () => {
    expect(javlibrary.supports('censored')).toBe(true)
    expect(javlibrary.supports('uncensored')).toBe(false)
    expect(javlibrary.supports('fc2')).toBe(false)
  })
})
