/**
 * 番号站点解析：用录制的页面（tests/fixtures/jav，已裁掉与解析无关的部分）验证字段提取，
 * 以及各站点的查询流程（直取详情 → 检索回退）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJavCode } from '../../../src/main/library/providers/jav/number'
import {
  avbase,
  avbaseRecord,
  pickAvbaseWork,
} from '../../../src/main/library/providers/jav/sites/avbase'
import {
  fc2,
  fc2Id,
  parseFc2Article,
} from '../../../src/main/library/providers/jav/sites/fc2'
import {
  javbus,
  javbusPoster,
  parseJavbusDetail,
  pickJavbusSearch,
} from '../../../src/main/library/providers/jav/sites/javbus'
import type { SiteContext } from '../../../src/main/library/providers/jav/types'
import { nextPageProps } from '../../../src/main/library/providers/jav/html'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../fixtures/jav', name), 'utf8')

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

describe('JavBus', () => {
  it('有码详情页：全部字段', () => {
    const r = parseJavbusDetail(
      fixture('javbus-SSIS-497.html'),
      'https://www.javbus.com/SSIS-497'
    )!
    expect(r).toMatchObject({
      site: 'javbus',
      code: 'SSIS-497',
      title:
        '最高のオンナ鷲尾めいが人生最高に尽くす一生忘れられない1日限定愛人契約',
      releaseDate: '2022-08-19',
      runtimeMinutes: 120,
      director: '嵐山みちる',
      studio: 'エスワン ナンバーワンスタイル',
      label: 'S1 NO.1 STYLE',
      series: '一生忘れられない1日限定愛人契約',
      cover: 'https://www.javbus.com/pics/cover/939o_b.jpg',
      poster: 'https://www.javbus.com/pics/thumb/939o.jpg',
    })
    expect(r.tags).toContain('巨乳')
    expect(r.tags).toHaveLength(9)
    expect(r.actors).toEqual([
      {
        name: '鷲尾めい',
        photo: 'https://www.javbus.com/pics/actress/w59_a.jpg',
      },
    ])
    expect(r.stills).toHaveLength(10)
    expect(r.stills[0]).toBe(
      'https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497jp-1.jpg'
    )
  })

  it('无码详情页（HEYZO / Carib）：封面在 /imgs/cover，海报在 /imgs/thumbs', () => {
    const heyzo = parseJavbusDetail(
      fixture('javbus-heyzo.html'),
      'https://www.javbus.com/HEYZO-0841'
    )!
    expect(heyzo.code).toBe('HEYZO-0841')
    expect(heyzo.title).toMatch(/^松本まりな/)
    expect(heyzo.poster).toBe('https://www.javbus.com/imgs/thumbs/vk6.jpg')
    const carib = parseJavbusDetail(
      fixture('javbus-carib.html'),
      'https://www.javbus.com/010120-001'
    )!
    expect(carib.code).toBe('010120-001')
    expect(carib.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(carib.cover).toBe('https://www.javbus.com/imgs/cover/18kk_b.jpg')
  })

  it('封面 → 海报地址；认不出的形态不猜', () => {
    expect(javbusPoster('https://www.javbus.com/pics/cover/abc_b.jpg')).toBe(
      'https://www.javbus.com/pics/thumb/abc.jpg'
    )
    expect(javbusPoster('https://example.com/x.jpg')).toBeUndefined()
  })

  it('不是详情页返回 null；检索结果只认番号对得上的', () => {
    expect(
      parseJavbusDetail(
        '<html><body>404</body></html>',
        'https://www.javbus.com/X-1'
      )
    ).toBeNull()
    const search = fixture('javbus-search.html')
    expect(pickJavbusSearch(search, 'SSIS-497')).toBe(
      'https://www.javbus.com/SSIS-497'
    )
    expect(pickJavbusSearch(search, 'ssis497')).toBe(
      'https://www.javbus.com/SSIS-497'
    )
    expect(pickJavbusSearch(search, 'SSIS-498')).toBeUndefined()
  })

  it('直取详情页 404 时走检索', async () => {
    const ctx = pages({
      'https://www.javbus.com/search/SSIS-497&type=&parent=ce':
        fixture('javbus-search.html'),
      'https://www.javbus.com/SSIS-497': fixture('javbus-SSIS-497.html'),
    })
    const direct = await javbus.fetch(parseJavCode('SSIS-497.mp4')!, ctx)
    expect(direct?.code).toBe('SSIS-497')
    expect(ctx.seen).toEqual(['https://www.javbus.com/SSIS-497'])
    const viaSearch = pages({
      'https://www.javbus.com/search/SSIS-497&type=&parent=ce':
        fixture('javbus-search.html'),
    })
    expect(
      await javbus.fetch(parseJavCode('SSIS-497.mp4')!, viaSearch)
    ).toBeNull()
    expect(viaSearch.seen).toHaveLength(3)
    expect(javbus.supports('fc2')).toBe(false)
  })
})

describe('AVBase', () => {
  it('详情页 __NEXT_DATA__：演员头像、制作商、导演、时长、简介、图片', () => {
    const work = nextPageProps(fixture('avbase-work.html'))!.work as Record<
      string,
      unknown
    >
    const r = avbaseRecord(work, 'https://www.avbase.net/works/SSIS-497')!
    expect(r).toMatchObject({
      site: 'avbase',
      code: 'SSIS-497',
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
    })
    expect(r.actors).toEqual([
      {
        name: '鷲尾めい',
        photo: 'https://pics.dmm.co.jp/mono/actjpgs/wasio_mei.jpg',
      },
    ])
    expect(r.tags).toContain('単体作品')
    expect(r.overview).toMatch(/^「今日だけだから/)
    expect(r.stills.length).toBeGreaterThan(5)
  })

  it('检索：只接受番号归一后相等的唯一条目', () => {
    const works = nextPageProps(fixture('avbase-search.html'))!.works as Array<
      Record<string, unknown>
    >
    expect(pickAvbaseWork(works, 'ssis497')?.work_id).toBe('SSIS-497')
    expect(pickAvbaseWork(works, 'SSIS-498')).toBeUndefined()
    const twins = [
      { work_id: 'ABC-1', prefix: 'x' },
      { work_id: 'ABC-001', prefix: 'y' },
    ]
    expect(pickAvbaseWork(twins, 'ABC-001')).toBeUndefined()
    expect(pickAvbaseWork([...twins, { work_id: 'ABC-1' }], 'ABC-001')).toEqual(
      { work_id: 'ABC-1' }
    )
  })

  it('直取失败时检索，检索为空返回 null', async () => {
    const code = parseJavCode('SSIS-497')!
    const direct = pages({
      'https://www.avbase.net/works/SSIS-497': fixture('avbase-work.html'),
    })
    expect((await avbase.fetch(code, direct))?.director).toBe('嵐山みちる')
    const viaSearch = pages({
      'https://www.avbase.net/works?q=SSIS-497': fixture('avbase-search.html'),
    })
    const fromSearch = await avbase.fetch(code, viaSearch)
    // 详情 404 时退回检索结果本身（没有导演 / 类别，但有演员与商品信息）
    expect(fromSearch).toMatchObject({
      code: 'SSIS-497',
      studio: 'エスワン ナンバーワンスタイル',
    })
    const empty = pages({
      'https://www.avbase.net/works?q=SSIS-497': fixture('avbase-empty.html'),
    })
    expect(await avbase.fetch(code, empty)).toBeNull()
    expect(avbase.supports('uncensored')).toBe(false)
  })
})

describe('FC2', () => {
  it('商品页：og:title 去番号前缀、卖家、发售日、时长、标签、图片', () => {
    const url = 'https://adult.contents.fc2.com/article/3662771/'
    const r = parseFc2Article(fixture('fc2-3662771.html'), url, '3662771')!
    expect(r).toMatchObject({
      site: 'fc2',
      code: 'FC2-PPV-3662771',
      releaseDate: '2023-08-10',
      runtimeMinutes: 53,
      studio: '素人0930',
      cover:
        'https://storage84000.contents.fc2.com/file/377/37682362/1691634315.7.jpg',
    })
    expect(r.title).toMatch(/^【豊満巨乳のスナック/)
    expect(r.title).not.toContain('FC2-PPV')
    expect(r.title).not.toContain('ysn')
    expect(r.poster).toMatch(/^https:\/\/contents-thumbnail2\.fc2\.com\/w276\//)
    expect(r.tags).toContain('人妻')
    expect(r.stills[0]).toMatch(
      /^https:\/\/contents-thumbnail2\.fc2\.com\/w1280\//
    )
    expect(r.overview).toMatch(/^素人0930/)
  })

  it('下架商品返回 null；只认 FC2-PPV 番号', async () => {
    expect(
      parseFc2Article(fixture('fc2-missing.html'), 'u', '1234567')
    ).toBeNull()
    expect(fc2Id('FC2-PPV-1234567')).toBe('1234567')
    expect(fc2Id('SSIS-497')).toBeUndefined()
    const ctx = pages({
      'https://adult.contents.fc2.com/article/3662771/':
        fixture('fc2-3662771.html'),
    })
    expect(
      (await fc2.fetch(parseJavCode('FC2-PPV-3662771')!, ctx))?.studio
    ).toBe('素人0930')
    expect(fc2.supports('censored')).toBe(false)
  })
})

describe('AVBase 素人番号', () => {
  it('站内把 259LUXU-1000 记作 LUXU-1000：去掉数字前缀后再比', () => {
    const works = [{ work_id: 'LUXU-1000', prefix: '' }]
    expect(pickAvbaseWork(works, '259LUXU-1000')).toEqual(works[0])
    expect(pickAvbaseWork(works, '259LUXU-1001')).toBeUndefined()
    // 常规番号不走宽松比较
    expect(
      pickAvbaseWork([{ work_id: '300ABC-123' }], 'ABC-123')
    ).toBeUndefined()
  })
})
