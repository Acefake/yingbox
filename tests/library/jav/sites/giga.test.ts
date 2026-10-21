/**
 * GIGA：年龄页判定、会话 Cookie 组装、检索与商品页解析（真实页面 GHKR-60），
 * 查询流程（领会话 → 检索 → 商品页）、会话失效重领、请求串行、宿主不支持 Cookie 时报错。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type CookieContext,
  createGigaSite,
  gigaKeywords,
  gigaSession,
  isGigaAgeGate,
  isGigaCode,
  parseGigaDetail,
  parseGigaSearch,
} from '../../../../src/main/library/providers/jav/sites/giga'
import type {
  PageOptions,
  SiteContext,
} from '../../../../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../../fixtures/jav', name), 'utf8')

const BASE = 'https://www.giga-web.jp'
const ENTRY = `${BASE}/cookie_set.php`
const SEARCH = `${BASE}/search/?keyword=GHKR-60`
const PRODUCT = `${BASE}/product/index.php?product_id=6218`
const GHKR = { code: 'GHKR-060', kind: 'censored', subtitle: false } as const

const ISSUED = [
  'PHPSESSID=abc123; path=/; secure; SameSite=none',
  'old_check=yes; path=/',
  'WSLB=www2; path=/',
]

/** 假宿主：模拟站点的会话状态机。只有带着「已确认」会话的请求才拿到正文，否则是年龄页。 */
function fakeGiga(opts: {
  issued?: string[][]
  pages?: Record<string, string>
}): CookieContext & {
  log: string[]
  inFlight: number
  maxInFlight: number
} {
  const issued = [...(opts.issued ?? [ISSUED])]
  const state = {
    log: [] as string[],
    inFlight: 0,
    maxInFlight: 0,
  }
  const pageMap = opts.pages ?? {
    [SEARCH]: fixture('giga-search-GHKR-60.html'),
    [PRODUCT]: fixture('giga-GHKR-60.html'),
  }
  return Object.assign(state, {
    issuedCookies: async (url: string): Promise<string[]> => {
      state.log.push(`claim ${url}`)
      return issued.shift() ?? ISSUED
    },
    page: async (url: string, options?: PageOptions) => {
      state.inFlight++
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
      await new Promise(r => setTimeout(r, 1))
      state.inFlight--
      state.log.push(`get ${url} [${options?.cookie ?? ''}]`)
      expect(options?.headers?.Referer).toBe(`${BASE}/`)
      if (!options?.cookie?.includes('PHPSESSID=abc123')) {
        return fixture('giga-age-gate.html')
      }
      return pageMap[url] ?? fixture('giga-search-empty.html')
    },
  })
}

describe('GIGA 解析', () => {
  it('年龄页判定：只认指向入口的链接', () => {
    expect(isGigaAgeGate(fixture('giga-age-gate.html'))).toBe(true)
    expect(isGigaAgeGate(fixture('giga-search-GHKR-60.html'))).toBe(false)
    expect(isGigaAgeGate(fixture('giga-search-empty.html'))).toBe(false)
    expect(isGigaAgeGate(fixture('giga-GHKR-60.html'))).toBe(false)
  })

  it('会话 Cookie：去掉属性；只有删除标记时视为没领到', () => {
    expect(gigaSession(ISSUED)).toBe(
      'PHPSESSID=abc123; old_check=yes; WSLB=www2'
    )
    expect(
      gigaSession([
        'PHPSESSID=deleted; expires=Thu, 01-Jan-1970',
        'old_check=yes',
      ])
    ).toBeUndefined()
  })

  it('前缀与检索关键词', () => {
    expect(isGigaCode('GHKR-060')).toBe(true)
    expect(isGigaCode('THPA-17')).toBe(true)
    expect(isGigaCode('SSIS-497')).toBe(false)
    expect(gigaKeywords('GHKR-060')).toEqual(['GHKR-60', 'GHKR-060'])
    expect(gigaKeywords('THPA-17')).toEqual(['THPA-17'])
  })

  it('检索页：商品链接；零结果页为空', () => {
    expect(parseGigaSearch(fixture('giga-search-GHKR-60.html'))).toEqual([
      PRODUCT,
    ])
    expect(parseGigaSearch(fixture('giga-search-empty.html'))).toEqual([])
  })

  it('商品页：全部字段', () => {
    const r = parseGigaDetail(
      fixture('giga-GHKR-60.html'),
      PRODUCT,
      'GHKR-060'
    )!
    expect(r).toMatchObject({
      site: 'giga',
      code: 'GHKR-60',
      url: PRODUCT,
      title: 'ヒロインVSハイレグ仮面 ～クロスピンク 羞恥のハイレグ地獄～',
      releaseDate: '2019-09-13',
      runtimeMinutes: 90,
      director: '宇那月',
      studio: 'GIGA',
      actors: [{ name: '水谷あおい' }],
      poster: `${BASE}/db_titles/ghkr/ghkr60/pac_s.jpg`,
      cover: `${BASE}/db_titles/ghkr/ghkr60/pac_l.jpg`,
    })
    // 取展开版简介，不是截断的折叠版
    expect(r.overview).toMatch(/是非楽しんでご覧下さい！！$/)
    expect(r.stills[0]).toBe(`${BASE}/db_titles/ghkr/ghkr60/sample/001_l.jpg`)
    expect(r.stills.length).toBeGreaterThan(3)
  })

  it('作品番号不符按没有处理', () => {
    expect(
      parseGigaDetail(fixture('giga-GHKR-60.html'), PRODUCT, 'GHKR-061')
    ).toBeNull()
  })
})

describe('GIGA 查询流程', () => {
  it('领会话 → 检索（去前导零）→ 商品页，会话只领一次', async () => {
    const site = createGigaSite()
    const ctx = fakeGiga({})
    const r = await site.fetch(GHKR, ctx)
    expect(r?.title).toMatch(/クロスピンク/)
    const session = 'PHPSESSID=abc123; old_check=yes; WSLB=www2'
    expect(ctx.log).toEqual([
      `claim ${ENTRY}`,
      `get ${SEARCH} [${session}]`,
      `get ${PRODUCT} [${session}]`,
    ])
    ctx.log.length = 0
    await site.fetch(GHKR, ctx)
    expect(ctx.log.filter(l => l.startsWith('claim'))).toEqual([])
  })

  it('入口第一次只回删除标记：再领一次', async () => {
    const site = createGigaSite()
    const ctx = fakeGiga({ issued: [['PHPSESSID=deleted'], ISSUED] })
    expect(await site.fetch(GHKR, ctx)).not.toBeNull()
    expect(ctx.log.filter(l => l.startsWith('claim'))).toHaveLength(2)
  })

  it('会话被站点作废（取页回年龄页）：重领一次再试', async () => {
    const site = createGigaSite()
    const ctx = fakeGiga({ issued: [['PHPSESSID=stale'], ISSUED] })
    expect(await site.fetch(GHKR, ctx)).not.toBeNull()
    expect(ctx.log.slice(0, 4)).toEqual([
      `claim ${ENTRY}`,
      `get ${SEARCH} [PHPSESSID=stale]`,
      `claim ${ENTRY}`,
      `get ${SEARCH} [PHPSESSID=abc123; old_check=yes; WSLB=www2]`,
    ])
  })

  it('重领后仍是年龄页：报错', async () => {
    const site = createGigaSite()
    const ctx = fakeGiga({})
    ctx.issuedCookies = async () => ['PHPSESSID=stale']
    await expect(site.fetch(GHKR, ctx)).rejects.toThrow('未被站点接受')
  })

  it('入口始终不下发会话：报错（计为站点失败，不是查无此片）', async () => {
    const site = createGigaSite()
    const ctx = fakeGiga({})
    ctx.issuedCookies = async () => ['PHPSESSID=deleted']
    await expect(site.fetch(GHKR, ctx)).rejects.toThrow('没有下发会话')
  })

  it('零结果：两种写法都查过后返回 null', async () => {
    const site = createGigaSite()
    const ctx = fakeGiga({ pages: {} })
    expect(await site.fetch(GHKR, ctx)).toBeNull()
    expect(ctx.log.filter(l => l.startsWith('get'))).toHaveLength(2)
  })

  it('并发查询时请求串行', async () => {
    const site = createGigaSite()
    const ctx = fakeGiga({})
    await Promise.all([site.fetch(GHKR, ctx), site.fetch(GHKR, ctx)])
    expect(ctx.maxInFlight).toBe(1)
    expect(ctx.log.filter(l => l.startsWith('claim'))).toHaveLength(1)
  })

  it('非 GIGA 前缀不发请求；宿主不支持 Cookie 时报错', async () => {
    const site = createGigaSite()
    const plain: SiteContext = {
      page: async () => {
        throw new Error('不该发请求')
      },
    }
    expect(
      await site.fetch(
        { code: 'SSIS-497', kind: 'censored', subtitle: false },
        plain
      )
    ).toBeNull()
    await expect(site.fetch(GHKR, plain)).rejects.toThrow('issuedCookies')
  })
})
