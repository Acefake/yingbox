/**
 * XCITY（xcity.jp）：站内检索 → 逐条核对详情页的「メーカー品番」。
 *
 * - 检索：/result_published/?q=<番号去横线>&sg=main&num=30。必须带站内 Referer，
 *   否则任何关键词都被 302 到「XCITYオリジナル」的固定结果；结果在 table.resultList 里，链到 /avod/detail/?id=…。
 * - 详情：标题 h1、「発売日 / 収録時間 / 監督 / メーカー・レーベル / シリーズ / ジャンル」各栏、
 *   出演链接 /idol/detail/，封面是封套大图（package-b），海报是封面缩略图（package/medium），简介 p.lead。
 * - 检索是模糊匹配，只接受品番归一后与查询完全相等的条目；最多核对前 3 条，避免一部片发一串请求。
 * Cookie adc=1 跳过年龄确认。
 * 行为参考 Amane 的 xcity 爬虫，代码独立实现。
 */
import { type CheerioAPI, load } from 'cheerio'
import { codeKey } from '../number'
import type { JavCode } from '../number'
import { absolute, clean, dateOf, minutesOf, unique } from '../html'
import type {
  JavRecord,
  JavSite,
  JavSiteId,
  PageOptions,
  SiteContext,
} from '../types'

export const XCITY_BASE = 'https://xcity.jp'

const SITE_ID = 'xcity' as JavSiteId

/** 最多核对几条检索结果。 */
const MAX_CANDIDATES = 3

const OPTIONS: PageOptions = {
  cookie: 'adc=1',
  headers: { Referer: `${XCITY_BASE}/`, 'Accept-Language': 'ja' },
}

/** 检索页地址（番号去横线）。 */
export function xcitySearchUrl(code: string): string {
  const q = encodeURIComponent(code.replace(/-/g, ''))
  return `${XCITY_BASE}/result_published/?q=${q}&sg=main&num=30`
}

/** 检索页 → 详情页地址列表（去重保序）。 */
export function parseXcitySearch(html: string): string[] {
  const $ = load(html)
  return unique(
    $('table.resultList a[href*="/detail/?id="]')
      .map((_, a) => absolute(XCITY_BASE, $(a).attr('href')))
      .get()
  )
}

/** 「<span class="koumoku">标签</span> 值」一栏（li）。 */
function row($: CheerioAPI, label: string): ReturnType<CheerioAPI> {
  return $('li')
    .filter((_, li) => clean($(li).children('.koumoku').text()) === label)
    .first()
}

/** 一栏的纯文本值（去掉标签）。 */
function rowText($: CheerioAPI, label: string): string | undefined {
  const li = row($, label).clone()
  li.children('.koumoku').remove()
  return clean(li.text())
}

/** 一栏里的链接文本。 */
function rowLinks($: CheerioAPI, label: string): string[] {
  return unique(
    row($, label)
      .find('a')
      .map((_, a) => clean($(a).text()))
      .get()
  )
}

/** 解析详情页；没有标题或品番与 expected 对不上返回 null。 */
export function parseXcityDetail(
  html: string,
  url: string,
  expected: string
): JavRecord | null {
  const $ = load(html)
  const title = clean(
    $('#program_detail_title').text() || $('h1').first().text()
  )
  const hinban = clean($('#hinban').text())
  if (!title || !hinban || codeKey(hinban) !== codeKey(expected)) return null
  const thumb = $('.photo .tn')
  return {
    site: SITE_ID,
    code: expected,
    url,
    title,
    releaseDate: dateOf(rowText($, '発売日')) ?? dateOf(rowText($, '配信日')),
    runtimeMinutes: minutesOf(rowText($, '収録時間')),
    director: clean($('#program_detail_director').text()),
    studio: clean($('#program_detail_maker_name').text()),
    label: clean($('#program_detail_label_name').text()),
    series: rowLinks($, 'シリーズ')[0],
    tags: rowLinks($, 'ジャンル'),
    // 只取「出演」栏；页面其它区域（推荐作品）也有 /idol/detail/ 链接
    actors: unique(
      row($, '出演')
        .find('a[href*="/idol/detail/"]')
        .map((_, a) => clean($(a).text()))
        .get()
    ).map(name => ({ name })),
    overview: clean($('p.lead').first().text()),
    cover: absolute(url, thumb.find('a').first().attr('href')),
    poster: absolute(url, thumb.find('img').first().attr('src')),
    stills: [],
  }
}

/** XCITY 站点。 */
export const xcity: JavSite = {
  id: SITE_ID,
  supports: kind => kind === 'censored',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const search = await ctx.page(xcitySearchUrl(target.code), OPTIONS)
    if (!search) return null
    for (const url of parseXcitySearch(search).slice(0, MAX_CANDIDATES)) {
      const html = await ctx.page(url, OPTIONS)
      const record = html ? parseXcityDetail(html, url, target.code) : null
      if (record) return record
    }
    return null
  },
}
