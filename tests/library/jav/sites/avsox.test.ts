/**
 * AVSOX：JSON 接口（search → getMovie）两次 POST、番号核对、多语言名字回退。
 * 录制响应为 2026-10-21 实抓。
 */
import { describe, expect, it } from 'vitest'
import { parseJavCode } from '../../../../src/main/library/providers/jav/number'
import {
  avsox,
  avsoxData,
  avsoxRecord,
  pickAvsoxMovie,
} from '../../../../src/main/library/providers/jav/sites/avsox'
import { fixture, pages } from './site-helpers'

const API = 'https://avsox.click/javu/data/api'

describe('AVSOX 解析', () => {
  it('详情：名字、类别、演员头像、图片', () => {
    const r = avsoxRecord(
      avsoxData(fixture('avsox-HEYZO-0841.json')),
      'https://avsox.click/cn/movies/kadbqln'
    )!
    expect(r).toMatchObject({
      site: 'avsox',
      code: 'HEYZO-0841',
      url: 'https://avsox.click/cn/movies/kadbqln',
      releaseDate: '2015-04-24',
      runtimeMinutes: 60,
      studio: 'HEYZO',
      series: 'HEYZO',
      cover:
        'https://file.netcdn.space/storage/heyzo/contents/3000/0841/images/player_thumbnail.jpg',
      poster:
        'https://file.netcdn.space/storage/heyzo/contents/3000/0841/images/thumbnail.jpg',
      stills: [],
    })
    expect(r.title).toMatch(/^松本まりな/)
    expect(r.overview).toMatch(/^妖艶すぎる美熟女/)
    expect(r.director).toBeUndefined()
    expect(r.tags).toContain('熟女')
    expect(r.actors).toHaveLength(1)
    expect(r.actors[0].name).toBe('松本まりな')
    expect(r.actors[0].photo).toMatch(
      /^https:\/\/file\.netcdn\.space\/.+\.webp$/
    )
  })

  it('日期型无码：制作商取日文名', () => {
    const r = avsoxRecord(avsoxData(fixture('avsox-010120-001.json')), 'u')!
    expect(r.code).toBe('010120-001')
    expect(r.studio).toBe('カリビアンコム')
    expect(r.actors.map(a => a.name)).toEqual(['如月結衣'])
  })

  it('外层 code 不是 200 当作没有', () => {
    expect(avsoxData(fixture('avsox-missing.json'))).toBeUndefined()
    expect(avsoxData(null)).toBeUndefined()
    expect(avsoxRecord(undefined, 'u')).toBeNull()
  })

  it('候选核对：写法一致优先（010120-001 与 010120_001 是两部片）', () => {
    const data = avsoxData(fixture('avsox-search-010120-001.json'))
    expect(pickAvsoxMovie(data, '010120-001')).toBe('nozzaem')
    expect(pickAvsoxMovie(data, '010120_001')).toBe('klqjqyq')
    // 归一后有两条对得上：不猜
    expect(pickAvsoxMovie(data, '010120 001')).toBeUndefined()
    expect(pickAvsoxMovie([], 'X')).toBeUndefined()
  })
})

describe('AVSOX 站点', () => {
  it('search → getMovie 两次 JSON POST', async () => {
    const ctx = pages({
      [`POST ${API}/search [{"search":"HEYZO-0841","lang":"cn"},60,1]`]:
        fixture('avsox-search-HEYZO-0841.json'),
      [`POST ${API}/getMovie ["kadbqln","cn"]`]: fixture(
        'avsox-HEYZO-0841.json'
      ),
    })
    const r = await avsox.fetch(parseJavCode('heyzo_841.mp4')!, ctx)
    expect(r?.code).toBe('HEYZO-0841')
    expect(r?.url).toBe('https://avsox.click/cn/movies/kadbqln')
    expect(ctx.seen).toHaveLength(2)
    expect(ctx.seen[0].options?.headers?.['Content-Type']).toBe(
      'application/json'
    )
    expect(ctx.seen[1].options?.headers?.Referer).toBe(
      'https://avsox.click/cn/movies/kadbqln'
    )
  })

  it('搜不到不取详情', async () => {
    const ctx = pages({
      [`POST ${API}/search [{"search":"HEYZO-9999","lang":"cn"},60,1]`]:
        '{"code":200,"data":[]}',
    })
    expect(await avsox.fetch(parseJavCode('HEYZO-9999')!, ctx)).toBeNull()
    expect(ctx.seen).toHaveLength(1)
  })

  it('只查无码', () => {
    expect(avsox.supports('uncensored')).toBe(true)
    expect(avsox.supports('censored')).toBe(false)
    expect(avsox.supports('fc2')).toBe(false)
  })
})
