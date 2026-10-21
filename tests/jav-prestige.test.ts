/**
 * PRESTIGE：候选 SKU、作品 JSON 解析、查询流程（SKU 依次试 → 详情）、前缀过滤。
 * JSON fixture 按 Amane 的字段名构造，未用真实响应验证（站点限日本 IP，沙箱访问回 CloudFront 403）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  prestige,
  prestigeRecord,
  prestigeSkus,
} from '../src/main/library/providers/jav/sites/prestige'
import type { SiteContext } from '../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures/jav', name), 'utf8')

const BASE = 'https://www.prestige-av.com'
const UUID = '5c0f6d47-2c1a-4bb5-9a43-0c8c3f5d9e21'

/** 按 URL 返回页面的假上下文；没登记的地址当 404。记录请求头里的 Accept。 */
function pages(
  map: Record<string, string>
): SiteContext & { seen: string[]; accepts: Array<string | undefined> } {
  const seen: string[] = []
  const accepts: Array<string | undefined> = []
  return {
    seen,
    accepts,
    page: async (url, options) => {
      seen.push(url)
      accepts.push(options?.headers?.Accept)
      return map[url] ?? null
    },
  }
}

describe('PRESTIGE', () => {
  it('候选 SKU：带横线 → 不带 → GOOE 特典版', () => {
    expect(prestigeSkus('ABW-350')).toEqual([
      'ABW-350',
      'ABW350',
      'GOOEABW-350',
      'GOOEABW350',
    ])
  })

  it('作品 JSON：番号取通常版 SKU，图片按朝向分到封面 / 海报', () => {
    const r = prestigeRecord(
      JSON.parse(fixture('prestige-ABW-350-product.json')),
      `${BASE}/goods/${UUID}?skuId=ABW-350`
    )!
    expect(r).toMatchObject({
      site: 'prestige',
      code: 'ABW-350',
      title: '（構造推定用サンプル）タイトル',
      releaseDate: '2023-03-10',
      runtimeMinutes: 150,
      director: '監督X',
      studio: 'プレステージ',
      label: 'ABSOLUTELY WONDERFUL',
      series: 'シリーズS',
      tags: ['単体作品', '美少女'],
      actors: [{ name: '女優A' }, { name: '女優B' }],
      overview: '作品紹介文のサンプル。',
      cover: `${BASE}/api/media/1/2/package.jpg`,
      poster: `${BASE}/api/media/1/2/front.jpg`,
      stills: [
        `${BASE}/api/media/1/2/cap1.jpg`,
        'https://image.example/cap2.jpg',
      ],
    })
  })

  it('没有 SKU 的作品返回 null', () => {
    expect(prestigeRecord({ title: 'x' }, 'u')).toBeNull()
  })

  it('查询：第一个 SKU 404，第二个命中，再取详情', async () => {
    const ctx = pages({
      [`${BASE}/api/sku/item/ABW350`]: fixture('prestige-ABW-350-sku.json'),
      [`${BASE}/api/product/${UUID}`]: fixture('prestige-ABW-350-product.json'),
    })
    const r = await prestige.fetch(
      { code: 'ABW-350', kind: 'censored', subtitle: false },
      ctx
    )
    expect(r?.url).toBe(`${BASE}/goods/${UUID}?skuId=ABW350`)
    expect(ctx.seen).toEqual([
      `${BASE}/api/sku/item/ABW-350`,
      `${BASE}/api/sku/item/ABW350`,
      `${BASE}/api/product/${UUID}`,
    ])
    expect(ctx.accepts.every(a => a === 'application/json')).toBe(true)
  })

  it('全部 SKU 都 404：没有这部片', async () => {
    const ctx = pages({})
    expect(
      await prestige.fetch(
        { code: 'ABW-999', kind: 'censored', subtitle: false },
        ctx
      )
    ).toBeNull()
    expect(ctx.seen).toHaveLength(4)
  })

  it('非 PRESTIGE 前缀不发请求', async () => {
    const ctx = pages({})
    expect(
      await prestige.fetch(
        { code: 'SSIS-497', kind: 'censored', subtitle: false },
        ctx
      )
    ).toBeNull()
    expect(ctx.seen).toEqual([])
  })
})
