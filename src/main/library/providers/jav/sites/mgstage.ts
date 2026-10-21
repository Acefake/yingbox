/**
 * MGS 動画（www.mgstage.com）：プレステージ系与素人（259LUXU / 300MIUM / SIRO …）作品。
 *
 * 流程：直取 /product/product_detail/<番号>/；素人番号再退站内检索（文件名常缺数字前缀，
 * LUXU-1234 实际是 259LUXU-1234），检索结果按「去掉数字前缀后番号相同」核对，不盲取第一条。
 * 详情页是 th / td 表格（出演・メーカー・収録時間・品番・配信開始日・シリーズ・レーベル・ジャンル）；
 * 封面取 #EnlargeImage 的链接（pb_e_ 横版全图），海报取 img.enlarge_image（pf_o1_ 竖版），
 * 剧照取 #sample-photo 里的大图链接。
 * 需要 adc=1 Cookie 跳过成人确认；成人确认页（标题含「成人認証」）说明 Cookie 没生效，按被拦抛错。
 * MGS 只对日本出口开放（CloudFront 地区限制，美国出口 403）。
 * 行为参考 Amane 的 mgstage 爬虫，代码独立实现；页面结构未用真实页面验证。
 */
import { type CheerioAPI, load } from 'cheerio'
import { codeKey } from '../number'
import type { JavCode } from '../number'
import {
  absolute,
  clean,
  dateOf,
  isPlaceholder,
  minutesOf,
  unique,
} from '../html'
import type { JavRecord, JavSite, PageOptions, SiteContext } from '../types'

export const MGSTAGE_BASE = 'https://www.mgstage.com'

const OPTIONS: PageOptions = {
  cookie: 'adc=1',
  headers: { 'Accept-Language': 'ja-JP,ja;q=0.9' },
}

/** 详情页地址。 */
export function mgstageDetailUrl(code: string): string {
  return `${MGSTAGE_BASE}/product/product_detail/${encodeURIComponent(code)}/`
}

/** 番号比较键：去掉素人数字前缀（259LUXU-1234 与 LUXU-1234 相同）。 */
function bareKey(code: string): string {
  return codeKey(code).replace(/^\d+(?=[a-z])/, '')
}

/** 详情表里「標籤：」行的值单元格。 */
function row($: CheerioAPI, label: RegExp): ReturnType<CheerioAPI> | undefined {
  const th = $('th')
    .filter((_, el) => label.test($(el).text()))
    .first()
  const td = th.next('td')
  return td.length ? td : undefined
}

/** 值单元格：有链接取链接文本，否则取整格文本。 */
function rowText($: CheerioAPI, label: RegExp): string | undefined {
  const td = row($, label)
  if (!td) return undefined
  return clean(td.find('a').first().text()) ?? clean(td.text())
}

/** 值单元格里的全部链接文本。 */
function rowLinks($: CheerioAPI, label: RegExp): string[] {
  const td = row($, label)
  if (!td) return []
  const links = td
    .find('a')
    .map((_, a) => clean($(a).text()))
    .get()
  return unique(links.length ? links : [clean(td.text())])
}

/**
 * 解析详情页；不是详情页（没有标题）返回 null，成人确认页抛错。
 *
 * @param url 详情页地址（品番缺失时从地址取番号）
 */
export function parseMgstageDetail(
  html: string,
  url: string
): JavRecord | null {
  const $ = load(html)
  if (/成人認証/.test($('title').text()))
    throw new Error('MGS 成人确认未通过（adc Cookie 未生效）')
  const title =
    clean($('#center_column .tag').first().text()) ??
    clean($('#center_column h1').first().text())
  // 不存在的商品会被带回首页 / 列表页：没有品番行也没有封面大图就不是详情页
  if (!title || (!row($, /品番/) && !$('#EnlargeImage').length)) return null
  const code =
    rowText($, /品番/) ??
    decodeURIComponent(/product_detail\/([^/]+)/.exec(url)?.[1] ?? '')
  const cover = absolute(url, $('#EnlargeImage').attr('href'))
  const poster = absolute(url, $('img.enlarge_image').attr('src'))
  return {
    site: 'mgstage',
    code,
    url,
    title,
    releaseDate: dateOf(rowText($, /配信開始日/) ?? rowText($, /商品発売日/)),
    runtimeMinutes: minutesOf(rowText($, /収録時間/)),
    studio: rowText($, /メーカー/),
    label: rowText($, /レーベル/),
    series: rowText($, /シリーズ/),
    tags: rowLinks($, /ジャンル/),
    actors: rowLinks($, /出演/).map(name => ({ name })),
    overview: clean(
      $('#introduction p.introduction').first().text() ||
        $('#introduction dd').first().text()
    ),
    cover: cover && !isPlaceholder(cover) ? cover : undefined,
    poster: poster && !isPlaceholder(poster) ? poster : undefined,
    stills: unique(
      $('#sample-photo a')
        .map((_, a) => absolute(url, $(a).attr('href')))
        .get()
        .filter(href => /\.(jpe?g|png|webp)(\?|$)/i.test(href))
    ),
  }
}

/** 检索结果里番号对得上的第一条详情页地址。 */
export function pickMgstageSearch(
  html: string,
  code: string
): string | undefined {
  const $ = load(html)
  const key = bareKey(code)
  for (const a of $('a[href*="/product/product_detail/"]').toArray()) {
    const href = absolute(MGSTAGE_BASE, $(a).attr('href'))
    const found = href && /product_detail\/([^/?#]+)/.exec(href)?.[1]
    if (href && found && bareKey(decodeURIComponent(found)) === key) return href
  }
  return undefined
}

/** MGS 動画站点。 */
export const mgstage: JavSite = {
  id: 'mgstage',
  supports: kind => kind === 'amateur' || kind === 'censored',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const direct = mgstageDetailUrl(target.code)
    const page = await ctx.page(direct, OPTIONS)
    const record = page ? parseMgstageDetail(page, direct) : null
    if (record) return record
    // 有码只认直取（プレステージ系番号在 MGS 上不带前缀）；素人番号才值得多一次检索
    if (target.kind !== 'amateur') return null
    const search = await ctx.page(
      `${MGSTAGE_BASE}/search/cSearch.php?search_word=${encodeURIComponent(target.code)}&type=top`,
      OPTIONS
    )
    const url = search ? pickMgstageSearch(search, target.code) : undefined
    if (!url || url === direct) return null
    const detail = await ctx.page(url, OPTIONS)
    return detail ? parseMgstageDetail(detail, url) : null
  },
}
