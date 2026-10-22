/**
 * FC2CLUB（fc2club.top，原 fc2club.net）：FC2 番号直接对应 /html/FC2-<数字>.html，只查 FC2。
 * 用来补 FC2 官方页没有的演员与标签。
 *
 * - 详情区 .show-top-grids：h3 是「FC2-<数字> 标题」；下面若干 h5 行以加粗标签开头
 *   （卖家信息 / 影片标签 / 女优名字），值是行内链接；
 *   新版页面另有演员卡片（ul.slides h5.title）、/tag/ 链接与「日期」行，两种写法都认；
 * - 封面是 #thumbpic 外层链接指向的大图，剧照是轮播 ul.slides 里的图；
 * - 站点现在先回一个脚本跳转页（window.location.replace + 一次性令牌），不执行脚本就到不了详情页，
 *   这种情况按「站点不可用」抛错，不当成查无此片缓存起来。
 *
 * 行为参考 Amane 的 fc2club 爬虫，代码独立实现。
 */
import type { CheerioAPI } from 'cheerio'
import { load } from '../../../../../shared/html/cheerio'
import type { JavCode } from '../number'
import { absolute, clean, dateOf, isPlaceholder, unique } from '../html'
import type { JavRecord, JavSite, SiteContext } from '../types'
import { fc2Id } from './fc2'

export const FC2CLUB_BASE = 'https://fc2club.top'

/** 演员 / 标签栏里的空值占位。 */
const EMPTY = /^(?:暂无|暫無|无|無|N\/A|-+)$/i

/** 脚本跳转页（反爬 / 域名停放）。 */
export function isFc2clubRedirect(html: string): boolean {
  return (
    !html.includes('show-top-grids') &&
    /window\.location\.(?:replace|href)/.test(html)
  )
}

/** 以加粗标签开头的信息行里的链接文本，如「女优名字：<a>…</a>」。 */
function labeledLinks($: CheerioAPI, label: RegExp): string[] {
  const row = $('.show-top-grids h5')
    .filter((_, h5) => label.test($(h5).find('strong').first().text()))
    .first()
  return row
    .find('a')
    .map((_, a) => clean($(a).text()))
    .get()
}

/** 去空值、占位后去重。 */
function names(values: Array<string | undefined>): string[] {
  return unique(values).filter(v => !EMPTY.test(v))
}

/** 解析详情页；没有详情区或标题返回 null。 */
export function parseFc2clubDetail(
  html: string,
  url: string,
  id: string
): JavRecord | null {
  const $ = load(html)
  const grids = $('.show-top-grids').first()
  const heading = clean(grids.find('h3').first().text())
  if (!heading) return null
  const title = clean(heading.replace(/^FC2[-_ ]*(?:PPV[-_ ]*)?\d+\s*/i, ''))
  const img = (src: string | undefined): string | undefined => {
    const abs = absolute(url, src)
    return abs && !isPlaceholder(abs) && !/blank\.\w+$/.test(abs)
      ? abs
      : undefined
  }
  const actors = names([
    ...labeledLinks($, /女优|女優/),
    ...grids
      .find('ul.slides h5.title')
      .map((_, h5) => clean($(h5).text()))
      .get(),
  ])
  const tags = names([
    ...labeledLinks($, /标签|標籤/),
    ...grids
      .find('a[href*="/tag/"]')
      .map((_, a) => clean($(a).text()))
      .get(),
  ])
  const dated = grids
    .find('p, h5')
    .filter((_, el) => /日期/.test($(el).text()))
    .first()
    .text()
  return {
    site: 'fc2club',
    code: `FC2-PPV-${id}`,
    url,
    title: title || heading,
    releaseDate: dateOf(dated),
    studio: names(labeledLinks($, /卖家|賣家/))[0],
    tags,
    actors: actors.map(name => ({ name })),
    cover:
      img(grids.find('#thumbpic').closest('a').attr('href')) ??
      img(grids.find('img').first().attr('src')),
    stills: unique(
      grids
        .find('ul.slides img')
        .map((_, el) => img($(el).attr('src')))
        .get()
    ),
  }
}

/** FC2CLUB 站点。 */
export const fc2club: JavSite = {
  id: 'fc2club',
  supports: kind => kind === 'fc2',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const id = fc2Id(target.code)
    if (!id) return null
    const url = `${FC2CLUB_BASE}/html/FC2-${id}.html`
    const html = await ctx.page(url)
    if (!html) return null
    if (isFc2clubRedirect(html)) {
      throw new Error('fc2club 返回脚本跳转页（站点失效或启用了防护）')
    }
    return parseFc2clubDetail(html, url, id)
  },
}
