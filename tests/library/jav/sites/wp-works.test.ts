/**
 * WordPress works 主题站点（faleno / dahlia）：REST 解析、HTML 退路（真实页面 dahlia-av.jp/works/dldss100/）、
 * canonical 核对、REST 被拦后的退路与记忆、前缀过滤。
 * REST 响应 fixture（faleno-FNS-257-rest.json）按 Amane 的字段名构造，未用真实响应验证（沙箱海外 IP 访问 wp-json 被 403）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProviderHttpError } from '../../../../src/main/library/providers/http/provider-http'
import { dahlia } from '../../../../src/main/library/providers/jav/sites/dahlia'
import { faleno } from '../../../../src/main/library/providers/jav/sites/faleno'
import {
  type WpWorksConfig,
  createWpWorksSite,
  parseWpWorksJson,
  parseWpWorksPage,
  splitActors,
  stripActorSuffix,
  wpSlug,
} from '../../../../src/main/library/providers/jav/sites/wp-works'
import type {
  JavSiteId,
  SiteContext,
} from '../../../../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../../fixtures/jav', name), 'utf8')

const FALENO: WpWorksConfig = {
  id: 'faleno' as JavSiteId,
  base: 'https://faleno.jp/top',
  studio: 'FALENO',
  label: 'FALENOstar',
  labelByPrefix: { mgold: 'maryGOLD' },
  prefixes: 'fns mgold',
}
const DAHLIA: WpWorksConfig = {
  id: 'dahlia' as JavSiteId,
  base: 'https://dahlia-av.jp',
  studio: 'DAHLIA',
  label: 'DAHLIA',
  prefixes: 'dldss',
}

const DLDSS = { code: 'DLDSS-100', kind: 'censored', subtitle: false } as const
const DAHLIA_API = 'https://dahlia-av.jp/wp-json/wp/v2/works?slug=dldss100'
const DAHLIA_PAGE = 'https://dahlia-av.jp/works/dldss100/'

/** 假上下文：值为字符串时返回页面，为 Error 时抛出，没登记的当 404。 */
function pages(
  map: Record<string, string | Error>
): SiteContext & { seen: string[] } {
  const seen: string[] = []
  return {
    seen,
    page: async url => {
      seen.push(url)
      const value = map[url]
      if (value instanceof Error) throw value
      return value ?? null
    },
  }
}

describe('wp-works 小工具', () => {
  it.each([
    ['FNS-257', 'fns257'],
    ['MGOLD_064', 'mgold064'],
    ['FNS-241SP', 'fns241sp'],
  ])('slug %s → %s', (code, slug) => {
    expect(wpSlug(code)).toBe(slug)
  })

  it.each([
    ['吉高寧々/本田もも', ['吉高寧々', '本田もも']],
    ['八蜜凛 女神ジュン', ['八蜜凛', '女神ジュン']],
    ['天使もえ、桃尻かなめ', ['天使もえ', '桃尻かなめ']],
    ['', []],
  ])('出演女優 %s', (value, actors) => {
    expect(splitActors(value)).toEqual(actors)
  })

  it('作品名末尾的出演者名去掉，不在末尾的保留', () => {
    expect(stripActorSuffix('衝撃移籍 明里つむぎ', ['明里つむぎ'])).toBe(
      '衝撃移籍'
    )
    expect(stripActorSuffix('夢見るふたご丼', ['黒澤ななみ'])).toBe(
      '夢見るふたご丼'
    )
  })
})

describe('wp-works REST 解析', () => {
  it('ACF 字段与图片（构造的响应）', () => {
    const r = parseWpWorksJson(
      FALENO,
      fixture('faleno-FNS-257-rest.json'),
      'FNS-257'
    )!
    expect(r).toMatchObject({
      site: 'faleno',
      code: 'FNS-257',
      url: 'https://faleno.jp/top/works/fns257/',
      title: '（構造推定用サンプル）作品タイトル',
      releaseDate: '2025-06-12',
      runtimeMinutes: 120,
      studio: 'FALENO',
      label: 'FALENOstar',
      actors: [{ name: '女優A' }],
      overview: '紹介文のサンプル。',
      cover:
        'https://cdn.faleno.net/top/wp-content/uploads/2025/05/fns257_1200.jpg',
      poster:
        'https://cdn.faleno.net/top/wp-content/uploads/2025/05/fns257_2125.jpg',
      stills: [
        'https://cdn.faleno.net/top/wp-content/uploads/2025/05/fns257_1.jpg',
      ],
    })
  })

  it('发行商按前缀区分', () => {
    const r = parseWpWorksJson(FALENO, '[{"slug":"mgold064"}]', 'MGOLD-064')
    expect(r?.label).toBe('maryGOLD')
  })

  it('空数组 = 没有这部片；不是数组 = 走不通', () => {
    expect(parseWpWorksJson(FALENO, '[]', 'FNS-257')).toBeNull()
    expect(
      parseWpWorksJson(FALENO, '{"code":"rest_no_route"}', 'FNS-257')
    ).toBeUndefined()
    expect(parseWpWorksJson(FALENO, '<html>', 'FNS-257')).toBeUndefined()
  })
})

describe('wp-works HTML 解析', () => {
  it('真实页面：字段与图片', () => {
    const r = parseWpWorksPage(
      DAHLIA,
      fixture('dahlia-DLDSS-100.html'),
      'DLDSS-100'
    )!
    expect(r).toMatchObject({
      site: 'dahlia',
      code: 'DLDSS-100',
      url: DAHLIA_PAGE,
      title:
        '2人きりの密室、汗ばむ身体、混ざり合う性欲・・・美乃すずめと全てを忘れて朝昼夜とハメ狂いたい。',
      releaseDate: '2022-08-25',
      runtimeMinutes: 190,
      studio: 'DAHLIA',
      label: 'DAHLIA',
      actors: [{ name: '美乃すずめ' }],
      cover:
        'https://cdn.faleno.net/dahlia/wp-content/uploads/2022/06/dldss100_1200.jpg',
    })
    expect(r.overview).toMatch(/^誰にも邪魔されない/)
    expect(r.stills).toHaveLength(10)
    expect(r.stills[0]).toBe(
      'https://cdn.faleno.net/dahlia/wp-content/uploads/2022/06/dldss100_4.jpg'
    )
  })

  it('被跳到别的作品（canonical 不符）按没有处理', () => {
    expect(
      parseWpWorksPage(DAHLIA, fixture('dahlia-DLDSS-100.html'), 'DLDSS-1')
    ).toBeNull()
  })
})

describe('wp-works 查询流程', () => {
  it('REST 有结果：一次请求', async () => {
    const site = createWpWorksSite(FALENO)
    const api = 'https://faleno.jp/top/wp-json/wp/v2/works?slug=fns257'
    const ctx = pages({ [api]: fixture('faleno-FNS-257-rest.json') })
    const r = await site.fetch(
      { code: 'FNS-257', kind: 'censored', subtitle: false },
      ctx
    )
    expect(r?.poster).toMatch(/fns257_2125/)
    expect(ctx.seen).toEqual([api])
  })

  it('REST 空数组：没有这部片，不再取 HTML', async () => {
    const site = createWpWorksSite(DAHLIA)
    const ctx = pages({ [DAHLIA_API]: '[]' })
    expect(await site.fetch(DLDSS, ctx)).toBeNull()
    expect(ctx.seen).toEqual([DAHLIA_API])
  })

  it('REST 403：退到 HTML，之后 30 分钟内直接走 HTML', async () => {
    let now = 0
    const site = createWpWorksSite(DAHLIA, () => now)
    const ctx = pages({
      [DAHLIA_API]: new ProviderHttpError('元数据源返回 HTTP 403', 403),
      [DAHLIA_PAGE]: fixture('dahlia-DLDSS-100.html'),
    })
    expect((await site.fetch(DLDSS, ctx))?.runtimeMinutes).toBe(190)
    expect(ctx.seen).toEqual([DAHLIA_API, DAHLIA_PAGE])

    ctx.seen.length = 0
    now = 10 * 60 * 1000
    await site.fetch(DLDSS, ctx)
    expect(ctx.seen).toEqual([DAHLIA_PAGE])

    ctx.seen.length = 0
    now = 31 * 60 * 1000
    await site.fetch(DLDSS, ctx)
    expect(ctx.seen).toEqual([DAHLIA_API, DAHLIA_PAGE])
  })

  it('其它错误照常抛出（计为站点失败）', async () => {
    const site = createWpWorksSite(DAHLIA)
    const ctx = pages({ [DAHLIA_API]: new ProviderHttpError('超时') })
    await expect(site.fetch(DLDSS, ctx)).rejects.toThrow('超时')
  })

  it('前缀不在站点清单里：不发请求', async () => {
    const ctx = pages({})
    expect(
      await faleno.fetch(
        { code: 'SSIS-497', kind: 'censored', subtitle: false },
        ctx
      )
    ).toBeNull()
    expect(
      await dahlia.fetch(
        { code: 'FNS-257', kind: 'censored', subtitle: false },
        ctx
      )
    ).toBeNull()
    expect(ctx.seen).toEqual([])
  })
})
