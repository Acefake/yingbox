/**
 * iQQTV（iqq5.xyz，会跳到当期镜像域名）：简体中文站，站内搜索 /cn/search.php?kw=<番号>，
 * 条目标题末尾带番号（独立一个词），核对后进播放页 /cn/player.php?uuid=…。
 *
 * - 搜索结果条目带片长（data-time，秒），详情页没有，所以片长从搜索结果带过去，不多发请求；
 * - 「克破 / 无码破解 / 无码流出」一类是去马赛克或流出版，没有有效元数据，跳过；
 * - 详情页：制作商与日期在 .note 里（日期是上架时间，通常比发行日晚几天，只作兜底），
 *   系列、简介在同一块，演员与类别在 .tag-info 里按 s_type=actor / s_type=tag 区分；
 *   类别里的画质、字幕等站点标记去掉；
 * - 页面里的剧照是带时效签名的视频截帧地址，过期即失效，不采用。
 */
import { load } from '../../../../../shared/html/cheerio'
import type { JavCode } from '../number'
import { absolute, clean, dateOf, isPlaceholder, unique } from '../html'
import type { JavRecord, JavSite, SiteContext } from '../types'
import { plainCode, sameCode } from './same-code'

export const IQQTV_BASE = 'https://iqq5.xyz'

/** 简体中文版路径前缀。 */
const LANG = '/cn'

/** 去马赛克 / 流出版的标记。 */
const BROKEN = /克破|[无無][码碼](?:破解|流出)/

/** 站点自己的画质 / 字幕标记，不是影片类别。 */
const SITE_TAG = /^(?:\d{3,4}p|[48]k|f?hd|.*高[畫画][質质]|中文(?:字幕)?)$/i

/** 搜索命中：详情页地址，以及条目上的片长。 */
export interface IqqtvHit {
  url: string
  runtimeMinutes?: number
}

/** 解析搜索结果页：标题里有一个词与番号对得上的第一条（跳过破坏版）。 */
export function pickIqqtvSearch(
  html: string,
  code: string
): IqqtvHit | undefined {
  const $ = load(html)
  for (const link of $('span.title > a[href]').toArray()) {
    const title = clean($(link).attr('title') ?? $(link).text())
    const url = absolute(IQQTV_BASE, $(link).attr('href'))
    if (!url || !title || BROKEN.test(title)) continue
    if (!title.split(' ').some(token => sameCode(token, code))) continue
    const seconds = Number(
      $(link).closest('.item').find('[data-time]').first().attr('data-time')
    )
    return {
      url,
      ...(seconds > 0 ? { runtimeMinutes: Math.round(seconds / 60) } : {}),
    }
  }
  return undefined
}

/** 解析详情页；不是详情页或是破坏版返回 null。runtimeMinutes 来自搜索结果。 */
export function parseIqqtvDetail(
  html: string,
  url: string,
  runtimeMinutes?: number
): JavRecord | null {
  const $ = load(html)
  const heading = clean($('h1[itemprop="name"], h1.h4.b').first().text())
  if (!heading || BROKEN.test(heading)) return null
  const tokens = heading.split(' ')
  const raw = clean($('.number').first().text()) ?? tokens[tokens.length - 1]
  if (!raw) return null
  const code = plainCode(raw)
  const title = clean(tokens.filter(t => !sameCode(t, code)).join(' '))
  // 制作商、日期、系列、简介同在 .note 所在的那一块，限定范围免得取到推荐列表里的
  const block = $('.note').first().closest('.content')
  const tagInfo = $('div.tag-info').first()
  const texts = (scope: ReturnType<typeof $>, selector: string): string[] =>
    unique(
      scope
        .find(selector)
        .map((_, a) => clean($(a).text()))
        .get()
    )
  const overview = clean(
    block
      .find('.intro p')
      .first()
      .text()
      .replace(/^\s*[简簡]介[：:]/, '')
      .split('*根据分发')[0]
  )
  const cover = absolute(
    url,
    $('meta[property="og:image"]').first().attr('content')
  )
  return {
    site: 'iqqtv',
    code,
    url,
    title: title || heading,
    releaseDate: dateOf(block.find('.note .date').first().text()),
    runtimeMinutes,
    studio: texts(block, '.note a[href*="s_type=fac"]')[0],
    series: texts(block, 'a[href*="s_type=series"]')[0],
    tags: texts(tagInfo, 'a[href*="s_type=tag"]').filter(
      t => !SITE_TAG.test(t)
    ),
    actors: texts(tagInfo, 'a[href*="s_type=actor"]').map(name => ({ name })),
    overview: overview && !BROKEN.test(overview) ? overview : undefined,
    cover: cover && !isPlaceholder(cover) ? cover : undefined,
    stills: [],
  }
}

/** iQQTV 站点。 */
export const iqqtv: JavSite = {
  id: 'iqqtv',
  supports: kind => kind !== 'fc2',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const search = await ctx.page(
      `${IQQTV_BASE}${LANG}/search.php?kw=${encodeURIComponent(target.code)}`
    )
    const hit = search ? pickIqqtvSearch(search, target.code) : undefined
    if (!hit) return null
    const html = await ctx.page(hit.url)
    return html ? parseIqqtvDetail(html, hit.url, hit.runtimeMinutes) : null
  },
}
