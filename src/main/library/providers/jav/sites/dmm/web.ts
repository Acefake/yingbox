/**
 * FANZA 网页（www.dmm.co.jp）：站内检索页与 DVD（mono）详情页。
 *
 * 只在 GraphQL 查不到时兜底，主要覆盖只出 DVD、没有配信版的作品：
 * - 检索页 /search/=/searchstr=<cid>/sort=ranking/ 是 Next.js 页面，结果的详情地址以 detailUrl 嵌在脚本里；
 * - 详情页的「発売日 / 収録時間 / メーカー / レーベル / シリーズ / 監督 / 出演者 / ジャンル / 品番」
 *   新版是 dt / dd 结构（#multi-column 与 #single-column 各渲染一份），旧版是 table 的 td / th，
 *   这里不依赖具体层级，按「标签单元格 → 紧邻的值单元格」统一取；
 * - 封面取 JSON-LD 的 image（没有退 og:image），ps.jpg 换 pl.jpg 得大图。
 * 需要 age_check_done=1 Cookie 跳过年龄确认；日本以外的出口会被 302 到地区限制页，此时抛错而不是当成查无此片。
 * 行为参考 Amane 的 dmm 爬虫，代码独立实现；页面结构未用真实页面验证（沙箱出口被地区限制）。
 */
import type { CheerioAPI } from 'cheerio'
import { load } from '../../../../../../shared/html/cheerio'
import {
  absolute,
  clean,
  dateOf,
  isPlaceholder,
  minutesOf,
  unique,
} from '../../html'
import type { JavRecord, PageOptions } from '../../types'
import { type DmmCid, cidToCode, pickCid } from './cid'

export const DMM_WEB = 'https://www.dmm.co.jp'

/** 年龄确认 Cookie。 */
export const DMM_WEB_OPTIONS: PageOptions = {
  cookie: 'age_check_done=1',
  headers: { 'Accept-Language': 'ja-JP,ja;q=0.9' },
}

/** 地区限制页（日本以外的出口会被重定向到这里）。 */
export function isRegionBlocked(html: string): boolean {
  return /not-available-in-your-region|お住まいの地域から(?:は)?ご利用になれません|not available in your region/i.test(
    html
  )
}

/** 检索页地址：DVD 版 cid 不补零，用 short 写法检索。 */
export function dmmSearchUrl(cid: DmmCid): string {
  return `${DMM_WEB}/search/=/searchstr=${encodeURIComponent(cid.short)}/sort=ranking/`
}

/** 详情地址的类别，数值越大越优先（配信版字段最全）。 */
type Category = 'digital' | 'mono' | 'other'
const PRIORITY: Record<Category, number> = { digital: 2, mono: 1, other: 0 }

/** 详情地址 → 类别。 */
export function categoryOf(url: string): Category {
  if (/video\.dmm\.co\.jp|\/digital\//.test(url)) return 'digital'
  if (/\/mono\//.test(url)) return 'mono'
  return 'other'
}

/** 详情地址里的 cid（cid= / id= 参数）。 */
export function cidOfUrl(url: string): string | undefined {
  return /[?&/](?:cid|id)=([^/&?#]+)/.exec(url)?.[1]
}

/** 检索页里所有 detailUrl（脚本里可能是转义的 JSON，也可能不是）。 */
function detailUrls(html: string): string[] {
  const raw = [
    ...html.matchAll(/detailUrl\\":\\"(.*?)\\"/g),
    ...html.matchAll(/"detailUrl":"(.*?)"/g),
  ].map(m => m[1])
  return unique(
    raw.map(value => {
      try {
        return JSON.parse(`"${value}"`) as string
      } catch {
        return value
      }
    })
  )
}

/**
 * 从检索页挑这部片的详情地址：cid 对得上的里面，按 配信 > DVD > 其他 取第一个。
 */
export function pickDmmSearch(html: string, cid: DmmCid): string | undefined {
  const byCid = new Map<string, string[]>()
  for (const url of detailUrls(html)) {
    if (categoryOf(url) === 'other') continue
    const id = cidOfUrl(url)
    if (id) byCid.set(id, [...(byCid.get(id) ?? []), url])
  }
  const id = pickCid([...byCid.keys()], cid)
  if (!id) return undefined
  return byCid
    .get(id)!
    .sort((a, b) => PRIORITY[categoryOf(b)] - PRIORITY[categoryOf(a)])[0]
}

/** 标签 → 值单元格（只看详情区；新版两套布局取第一套）。 */
function fields($: CheerioAPI): Map<string, ReturnType<CheerioAPI>> {
  const scope = $('#multi-column').length ? $('#multi-column') : $('body')
  const map = new Map<string, ReturnType<CheerioAPI>>()
  scope.find('dt, td, th').each((_, cell) => {
    const label = clean($(cell).text())?.replace(/[：:]$/, '')
    if (!label || label.length > 10 || map.has(label)) return
    const value = $(cell).next('dd, td')
    if (value.length) map.set(label, value)
  })
  return map
}

/** 值单元格的文本（优先 span.content-detail__text，再退整格文本；「----」视为空）。 */
function textOf(cell: ReturnType<CheerioAPI> | undefined): string | undefined {
  if (!cell) return undefined
  const span = cell.find('.content-detail__text').first()
  const value = clean((span.length ? span : cell).text())
  return value && !/^-+$/.test(value) ? value : undefined
}

/** 值单元格里的多个值（链接或 span 各算一个）。 */
function listOf(
  $: CheerioAPI,
  cell: ReturnType<CheerioAPI> | undefined
): string[] {
  if (!cell) return []
  const items = cell.find('a, .content-detail__text')
  if (!items.length) return textOf(cell) ? [textOf(cell)!] : []
  return unique(items.map((_, el) => clean($(el).text())).get()).filter(
    v => !/^-+$/.test(v) && !/^[▼▲]|すべて表示/.test(v)
  )
}

/** JSON-LD（Product）里的字段。 */
function jsonLd($: CheerioAPI): Record<string, unknown> {
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(script).text()) as unknown
      if (data && typeof data === 'object')
        return data as Record<string, unknown>
    } catch {
      // 坏的 JSON-LD 跳过
    }
  }
  return {}
}

/**
 * 解析 DVD（mono）详情页；不是详情页（没有标题）返回 null。
 * 地区限制页 / 年龄确认页抛错（被拦，不是查无此片）。
 */
export function parseDmmMono(html: string, url: string): JavRecord | null {
  if (isRegionBlocked(html))
    throw new Error('DMM 网页限制了当前地区（需要日本出口）')
  const $ = load(html)
  if (/年齢認証/.test($('title').text())) throw new Error('DMM 年龄确认未通过')
  const ld = jsonLd($)
  const title =
    clean($('h1#title').first().text()) ??
    clean($('h1').first().text()) ??
    (typeof ld.name === 'string' ? clean(ld.name) : undefined)
  if (!title) return null
  const f = fields($)
  const ldImage = Array.isArray(ld.image) ? ld.image[0] : ld.image
  const image = absolute(
    url,
    (typeof ldImage === 'string' ? ldImage : undefined) ??
      $('meta[property="og:image"]').attr('content')
  )
  const cover =
    image && !isPlaceholder(image)
      ? image.replace(/ps\.jpg$/, 'pl.jpg')
      : undefined
  const productId = textOf(f.get('品番')) ?? cidOfUrl(url)
  const description =
    (typeof ld.description === 'string' ? clean(ld.description) : undefined) ??
    clean($('meta[name="description"]').attr('content'))
  return {
    site: 'dmm',
    code: productId ? cidToCode(productId) : title,
    url,
    title,
    releaseDate: dateOf(textOf(f.get('発売日')) ?? textOf(f.get('配信開始日'))),
    runtimeMinutes: minutesOf(textOf(f.get('収録時間'))),
    director: listOf($, f.get('監督'))[0],
    studio: listOf($, f.get('メーカー'))[0],
    label: listOf($, f.get('レーベル'))[0],
    series: listOf($, f.get('シリーズ'))[0],
    tags: listOf($, f.get('ジャンル')),
    actors: listOf($, f.get('出演者')).map(name => ({ name })),
    overview: description,
    cover,
    poster: cover?.replace(/pl\.jpg$/, 'ps.jpg'),
    // 剧照缩略图 xxx-1.jpg 的大图是 xxxjp-1.jpg
    stills: unique(
      $('#sample-image-block a, a[name="sample-image"]')
        .map((_, a) => {
          const src =
            $(a).attr('href') ??
            $(a).find('img').attr('data-lazy') ??
            $(a).find('img').attr('src')
          return absolute(url, src?.replace(/(?<!jp)-(\d+)\.jpg$/, 'jp-$1.jpg'))
        })
        .get()
    ),
  }
}
