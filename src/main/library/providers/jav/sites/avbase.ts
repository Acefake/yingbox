/**
 * AVBase（www.avbase.net）：Next.js 站点，数据在页面内嵌的 __NEXT_DATA__ 里，直接读 JSON，不做 DOM 解析。
 *
 * 先直取 /works/<番号>；没有时用 /works?q=<番号> 检索（模糊匹配），只接受番号归一后完全相等的条目，
 * 同番号多条时取没有厂牌前缀的那条，仍不唯一就放弃（猜错等于把别的片写成这个番号）。
 * 制作商 / 发行商 / 系列 / 导演 / 时长 / 简介 / 图片取自条目下的商品（FANZA 等）。
 */
import { codeKey } from '../number'
import type { JavCode } from '../number'
import {
  clean,
  jsDateOf,
  list,
  minutesOf,
  nextPageProps,
  str,
  unique,
} from '../html'
import type { JavActor, JavRecord, JavSite, SiteContext } from '../types'

export const AVBASE_BASE = 'https://www.avbase.net'

type Obj = Record<string, unknown>

/** 商品上某个具名对象的 name（maker / label / series）。 */
function named(products: Obj[], key: string): string | undefined {
  for (const p of products) {
    const name = str(p[key], 'name')
    if (name) return name
  }
  return undefined
}

/** 商品 iteminfo 里的字段，取第一个有值的。 */
function itemInfo(products: Obj[], key: string): string | undefined {
  for (const p of products) {
    const value = str(p.iteminfo, key)
    if (value) return value
  }
  return undefined
}

/** 演员：详情页是 casts[].actor，检索结果是 actors[]。 */
function actorsOf(work: Obj): JavActor[] {
  const raw = [
    ...list(work, 'casts').map(c => c.actor as Obj | undefined),
    ...list(work, 'actors'),
  ]
  const out = new Map<string, JavActor>()
  for (const a of raw) {
    const name = str(a, 'name')
    if (!name || out.has(name)) continue
    const photo = str(a, 'image_url')
    out.set(name, { name, ...(photo ? { photo } : {}) })
  }
  return [...out.values()]
}

/** 条目 JSON → 站点结果；没有番号返回 null。 */
export function avbaseRecord(work: Obj, url: string): JavRecord | null {
  const code = str(work, 'work_id')
  if (!code) return null
  const products = list(work, 'products')
  const stills = products.flatMap(p =>
    list(p, 'sample_image_urls').map(s => str(s, 'l') ?? str(s, 's'))
  )
  const description = itemInfo(products, 'description')
  return {
    site: 'avbase',
    code,
    url,
    title: str(work, 'title'),
    releaseDate: jsDateOf(str(work, 'min_date')),
    runtimeMinutes: minutesOf(itemInfo(products, 'volume')),
    director: itemInfo(products, 'director'),
    studio: named(products, 'maker'),
    label: named(products, 'label'),
    series: named(products, 'series'),
    tags: unique(list(work, 'genres').map(g => str(g, 'name'))),
    actors: actorsOf(work),
    overview: clean(description),
    cover: products.map(p => str(p, 'image_url')).find(Boolean),
    poster: products.map(p => str(p, 'thumbnail_url')).find(Boolean),
    stills: unique(stills),
  }
}

/** 条目地址：有厂牌前缀时 /works/<prefix>:<id>。 */
export function avbaseWorkUrl(work: Obj): string {
  const id = encodeURIComponent(str(work, 'work_id') ?? '')
  const prefix = str(work, 'prefix')
  return `${AVBASE_BASE}/works/${prefix ? `${encodeURIComponent(prefix)}:${id}` : id}`
}

/** 去掉素人番号的数字前缀（AVBase 把 259LUXU-1000 记作 LUXU-1000）。 */
const withoutDigits = (key: string): string => key.replace(/^\d+/, '')

/** 同番号多条时取没有厂牌前缀的唯一一条，仍不唯一返回 undefined。 */
function single(same: Obj[]): Obj | undefined {
  if (same.length <= 1) return same[0]
  const plain = same.filter(w => !str(w, 'prefix'))
  return plain.length === 1 ? plain[0] : undefined
}

/**
 * 检索结果里挑番号对得上的唯一条目。先要求归一后完全相等；
 * 没有时（素人番号）再比较去掉数字前缀后的写法。
 */
export function pickAvbaseWork(works: Obj[], code: string): Obj | undefined {
  const key = codeKey(code)
  const keyOf = (w: Obj): string => codeKey(str(w, 'work_id') ?? '')
  const exact = works.filter(w => keyOf(w) === key)
  if (exact.length) return single(exact)
  const loose = withoutDigits(key)
  if (loose === key) return undefined
  return single(works.filter(w => withoutDigits(keyOf(w)) === loose))
}

/** 页面 → 详情条目 JSON。 */
function workOf(html: string | null): Obj | undefined {
  const work = html ? nextPageProps(html)?.work : undefined
  return work && typeof work === 'object' ? (work as Obj) : undefined
}

/** AVBase 站点。 */
export const avbase: JavSite = {
  id: 'avbase',
  supports: kind => kind === 'censored' || kind === 'amateur',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const direct = `${AVBASE_BASE}/works/${encodeURIComponent(target.code)}`
    const work = workOf(await ctx.page(direct))
    if (work && pickAvbaseWork([work], target.code)) {
      return avbaseRecord(work, direct)
    }
    const search = await ctx.page(
      `${AVBASE_BASE}/works?q=${encodeURIComponent(target.code)}`
    )
    const props = search ? nextPageProps(search) : undefined
    const picked = pickAvbaseWork(list(props, 'works'), target.code)
    if (!picked) return null
    const url = avbaseWorkUrl(picked)
    // 检索结果缺类别、导演等字段，取一次详情；详情拿不到时退回检索结果
    const detail = workOf(await ctx.page(url))
    return avbaseRecord(detail ?? picked, url)
  },
}
