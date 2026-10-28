/**
 * Getchu.com（www.getchu.com）：成人动画（里番）与美少女游戏的商品页，按品番找作品。
 *
 * 流程：站内检索 /php/nsearch.phtml?search_keyword=<番号>，取前几条 soft.phtml?id= 商品，
 * 逐个打开详情页核对「品番」（Getchu 检索是全文模糊匹配，第一条常常不是这部片）。
 * 详情页：标题 h1#soft-title；信息表 #soft_table 的「発売日 / ブランド / 品番 / 監督 / ジャンル」；
 * 封面取 package 大图（a.highslide），退 img.product_img；剧照取 sample 图链接；简介取「商品紹介 / ストーリー」段落。
 * 需要 getchu_adalt_flag=getchu.com Cookie 跳过成人确认。页面是 EUC-JP，靠 HTTP 层按页面字符集解码。
 * 图片校验同源 Referer（media-referer 名单里加了 www.getchu.com）。Getchu 只对日本出口开放（美国出口 403）。
 * 页面结构未用真实页面验证。
 */
import type { CheerioAPI } from 'cheerio'
import { load } from '../../../../../shared/html/cheerio'
import { codeKey } from '../number'
import type { JavCode } from '../number'
import { absolute, clean, dateOf, isPlaceholder, unique } from '../html'
import type { JavRecord, JavSite, PageOptions, SiteContext } from '../types'

export const GETCHU_BASE = 'https://www.getchu.com'

const OPTIONS: PageOptions = {
  cookie: 'getchu_adalt_flag=getchu.com; gc=gc',
  headers: { 'Accept-Language': 'ja-JP,ja;q=0.9' },
}

/** 检索最多核对几条（每条一次详情页请求）。 */
const MAX_CANDIDATES = 2

/** 检索地址。 */
export function getchuSearchUrl(code: string): string {
  return `${GETCHU_BASE}/php/nsearch.phtml?search_keyword=${encodeURIComponent(code)}&gc=gc`
}

/** 检索结果里的商品详情地址（去重保序，统一成 https 绝对地址）。 */
export function getchuCandidates(html: string): string[] {
  const $ = load(html)
  return unique(
    $('a[href*="soft.phtml?id="]')
      .map((_, a) => {
        const id = /soft\.phtml\?id=(\d+)/.exec($(a).attr('href') ?? '')?.[1]
        return id ? `${GETCHU_BASE}/soft.phtml?id=${id}` : undefined
      })
      .get()
  )
}

/** 信息表里「標籤：」后面的值单元格。 */
function cell(
  $: CheerioAPI,
  label: RegExp
): ReturnType<CheerioAPI> | undefined {
  const td = $('#soft_table td, table td')
    .filter(
      (_, el) =>
        label.test(clean($(el).text()) ?? '') && $(el).text().length < 20
    )
    .first()
  const value = td.next('td')
  return value.length ? value : undefined
}

/** 值单元格文本（有链接取链接）。 */
function cellText($: CheerioAPI, label: RegExp): string | undefined {
  const td = cell($, label)
  if (!td) return undefined
  return clean(td.find('a').first().text()) ?? clean(td.text())
}

/** 简介：「商品紹介」或「ストーリー」标题后面的正文块。 */
function overviewOf($: CheerioAPI): string | undefined {
  const heading = $('.tabletitle')
    .filter((_, el) => /商品紹介|ストーリー/.test($(el).text()))
    .first()
  return clean(heading.nextAll('.tablebody').first().text())
}

/**
 * 解析商品详情页；不是商品页（没有标题）返回 null。
 * 成人确认页（没带上 Cookie）抛错。
 */
export function parseGetchuDetail(html: string, url: string): JavRecord | null {
  const $ = load(html)
  if (/年齢認証|18歳未満/.test($('title').text()))
    throw new Error('Getchu 成人确认未通过')
  const heading = $('h1#soft-title').first().clone()
  // 标题后面跟着「（ブランド名）」「[初回版]」一类附加标记
  heading.children().remove()
  const title = clean(heading.text())
  if (!title) return null
  const packageImage =
    $('a.highslide')
      .map((_, a) => $(a).attr('href'))
      .get()
      .find(href => /package/i.test(href)) ??
    $('img.product_img').first().attr('src')
  const cover = absolute(`${GETCHU_BASE}/`, packageImage)
  return {
    site: 'getchu',
    code: cellText($, /品番/) ?? '',
    url,
    title,
    releaseDate: dateOf(cellText($, /発売日/)),
    director: cellText($, /監督/),
    studio: cellText($, /ブランド/),
    tags: unique(
      (cell($, /ジャンル/) ?? $('#soft_table'))
        .find('a[href*="genre"]')
        .map((_, a) => clean($(a).text()))
        .get()
    ),
    actors: [],
    overview: overviewOf($),
    cover: cover && !isPlaceholder(cover) ? cover : undefined,
    stills: unique(
      $('a.highslide')
        .map((_, a) => $(a).attr('href'))
        .get()
        .filter(href => /sample/i.test(href))
        .map(href => absolute(`${GETCHU_BASE}/`, href))
    ),
  }
}

/** Getchu 站点。 */
export const getchu: JavSite = {
  id: 'getchu',
  supports: kind => kind === 'censored',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const search = await ctx.page(getchuSearchUrl(target.code), OPTIONS)
    if (!search) return null
    const key = codeKey(target.code)
    for (const url of getchuCandidates(search).slice(0, MAX_CANDIDATES)) {
      const detail = await ctx.page(url, OPTIONS)
      const record = detail ? parseGetchuDetail(detail, url) : null
      if (record?.code && codeKey(record.code) === key) return record
    }
    return null
  },
}
