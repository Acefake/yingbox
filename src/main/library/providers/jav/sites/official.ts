/**
 * 厂商官网（S1 / MOODYZ / IdeaPocket / Madonna 等 WILL 系厂牌）：按番号前缀查路由表找到厂商官网，
 * 直取 /works/detail/<小写番号去横线>，一次请求。
 *
 * 这些官网共用一套系统，作品信息在「div.th 标签 + div.td 值」的表里；横版封面是作品轮播首图，其余是剧照，
 * 官网不提供竖版海报。作品不存在时站点仍回 200，页面标题是「404 | …」、没有「品番」栏，按没有处理；
 * 页面上的品番与查询番号对不上（被跳到别的作品）同样按没有处理。
 * 路由表见 official-makers.ts。
 * 行为参考 Amane 的 official 爬虫，代码独立实现。
 */
import type { CheerioAPI } from 'cheerio'
import { load } from '../../../../../shared/html/cheerio'
import { codeKey } from '../number'
import type { JavCode } from '../number'
import { absolute, clean, dateOf, minutesOf, unique } from '../html'
import type { JavRecord, JavSite, JavSiteId, SiteContext } from '../types'
import { type OfficialMaker, makerOf } from './official-makers'

const SITE_ID = 'official' as JavSiteId

/** 番号 → 官网详情页地址；不在路由表里返回 undefined。 */
export function officialUrl(code: string): string | undefined {
  const maker = makerOf(code)
  if (!maker) return undefined
  const slug = code.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `https://${maker.domain}/works/detail/${slug}`
}

/** 「2022年8月23日」或 2022-08-23 → YYYY-MM-DD。 */
function japaneseDateOf(text: string | undefined): string | undefined {
  const m = text && /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(text)
  if (!m) return dateOf(text)
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/** 作品信息表里某一栏的值节点（标签文字包含 label 的 div.th 后面的 div.td）。 */
function cell($: CheerioAPI, label: string): ReturnType<CheerioAPI> {
  return $('.th')
    .filter((_, el) => $(el).text().includes(label))
    .first()
    .nextAll('.td')
    .first()
}

/** 值节点里的段落文本，去掉 DVD / BD 角标。 */
function cellText($: CheerioAPI, label: string): string | undefined {
  const p = cell($, label).find('p').first().clone()
  p.find('span').remove()
  return clean(p.text())
}

/** 值节点里的链接文本。 */
function cellLinks($: CheerioAPI, label: string, href: string): string[] {
  return unique(
    cell($, label)
      .find(`a[href*="${href}"]`)
      .map((_, a) => clean($(a).text()))
      .get()
  )
}

/** 页面标题后缀「…【S1 NO.1 STYLE (エスワン…)】公式サイト」里的厂商主名称。 */
function studioOf(title: string): string | undefined {
  const suffix = title.split(' | ').pop() ?? ''
  const inner = /【(.+?)】/.exec(suffix)?.[1]
  return clean(inner?.split('(')[0])
}

/**
 * 解析官网详情页。没有品番栏（404 页）或品番与 expected 对不上时返回 null。
 *
 * @param maker 路由到的厂商：页面标题里认不出制作商时用它的显示名
 */
export function parseOfficialDetail(
  html: string,
  url: string,
  expected: string,
  maker?: OfficialMaker
): JavRecord | null {
  const $ = load(html)
  const pageCode = /[A-Z]+\d+[A-Z]?/i.exec(cellText($, '品番') ?? '')?.[0]
  if (!pageCode || codeKey(pageCode) !== codeKey(expected)) return null

  const pageTitle = clean($('title').first().text()) ?? ''
  const title =
    clean($('.p-workPage__title').first().text()) ??
    clean(pageTitle.split(' | ').slice(0, -1).join(' | '))
  const slides = $('.p-slider .swiper-lazy')
    .map((_, img) => absolute(url, $(img).attr('data-src')))
    .get()
  const dateCell = cell($, '発売日').find('a').first()
  return {
    site: SITE_ID,
    code: expected,
    url,
    title,
    releaseDate:
      japaneseDateOf(dateCell.text()) ?? dateOf(dateCell.attr('href')),
    runtimeMinutes: minutesOf(cellText($, '収録時間')),
    director: cellText($, '監督'),
    studio: studioOf(pageTitle) ?? maker?.name,
    series: cellLinks($, 'シリーズ', '/works/list/')[0],
    tags: cellLinks($, 'ジャンル', '/works/list/genre/'),
    // 只取作品信息表的「女優」栏；推荐作品区也有 /actress/detail/ 链接
    actors: cellLinks($, '女優', '/actress/detail/').map(name => ({ name })),
    overview: clean($('.p-workPage__text').first().text()),
    cover: slides[0],
    stills: unique(slides.slice(1)),
  }
}

/** 厂商官网站点。 */
export const official: JavSite = {
  id: SITE_ID,
  supports: kind => kind === 'censored',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const maker = makerOf(target.code)
    const url = officialUrl(target.code)
    if (!maker || !url) return null
    const html = await ctx.page(url)
    return html ? parseOfficialDetail(html, url, target.code, maker) : null
  },
}
