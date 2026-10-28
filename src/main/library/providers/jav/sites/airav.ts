/**
 * AIRAV（airav.io）：站内搜索 /search_result?kw=<番号>，条目标题以番号开头，核对后进详情页 /video?hid=…。
 *
 * - 详情页是繁体中文：标题为中文译名，有中文简介（og:description 与正文同一段）；
 * - 信息表「番號 / 女優 / 標籤 / 廠商」各是一行，演员、类别、厂商按链接参数区分
 *   （actor?id= / tag?tid= / tag?fid=）；类别里混有画质、字幕等站点标记，去掉；
 * - 页面上的日期是上架时间（通常比发行日晚几天），只作兜底；不给片长（只有固定的试看时长）；
 * - 日期型无码番号在站上写作 caribbeancom010120-001 一类，核对时允许厂牌前缀，记录时去掉。
 */
import { load } from '../../../../../shared/html/cheerio'
import type { JavCode } from '../number'
import { absolute, clean, dateOf, isPlaceholder, unique } from '../html'
import type { JavRecord, JavSite, SiteContext } from '../types'
import { plainCode, sameCode } from './same-code'

export const AIRAV_BASE = 'https://airav.io'

/** 站点自己的画质 / 字幕标记，不是影片类别。 */
const SITE_TAG = /^(?:\d{3,4}p|[48]k|f?hd|.*高[畫画]質|中文(?:字幕)?)$/i

/** 标题的第一个词（番号）。 */
function leadingToken(text: string): string {
  return text.trim().split(/\s+/)[0] ?? ''
}

/** 解析搜索结果页：返回标题开头番号对得上的第一条详情页地址。 */
export function pickAiravSearch(
  html: string,
  code: string
): string | undefined {
  const $ = load(html)
  for (const item of $('.oneVideo').toArray()) {
    const href = absolute(AIRAV_BASE, $(item).find('a[href]').attr('href'))
    const title = clean($(item).find('h5').first().text())
    if (href && title && sameCode(leadingToken(title), code)) return href
  }
  return undefined
}

/** 解析详情页；没有番号或标题（不是详情页）返回 null。 */
export function parseAiravDetail(html: string, url: string): JavRecord | null {
  const $ = load(html)
  const info = '.video-info'
  const raw = clean(
    $(`${info} li`)
      .filter((_, li) => /番[號号]/.test($(li).text()))
      .first()
      .find('span')
      .first()
      .text()
  )
  const heading = clean($('.video-title h1').first().text())
  if (!raw || !heading) return null
  const code = plainCode(raw)
  const token = leadingToken(heading)
  const title = sameCode(token, raw)
    ? clean(heading.slice(token.length))
    : heading
  const texts = (selector: string): string[] =>
    unique(
      $(selector)
        .map((_, a) => clean($(a).text()))
        .get()
    )
  const cover = absolute(
    url,
    $('meta[property="og:image"]').first().attr('content')
  )
  return {
    site: 'airav',
    code,
    url,
    title: title || heading,
    releaseDate: dateOf($('.video-item .fa-clock').first().parent().text()),
    studio: texts(`${info} a[href*="tag?fid="]`)[0],
    tags: texts(`${info} a[href*="tag?tid="]`).filter(t => !SITE_TAG.test(t)),
    actors: texts(`${info} a[href*="actor?id="]`).map(name => ({ name })),
    overview: clean($(`${info} > p`).first().text()),
    cover: cover && !isPlaceholder(cover) ? cover : undefined,
    stills: [],
  }
}

/** AIRAV 站点。 */
export const airav: JavSite = {
  id: 'airav',
  supports: kind => kind !== 'fc2',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const search = await ctx.page(
      `${AIRAV_BASE}/search_result?kw=${encodeURIComponent(target.code)}`
    )
    const url = search ? pickAiravSearch(search, target.code) : undefined
    if (!url) return null
    const html = await ctx.page(url)
    return html ? parseAiravDetail(html, url) : null
  },
}
