/**
 * 金髪天國（www.kin8tengoku.com）：番号 KIN8-<4 位编号> 直接对应 /movie/<编号>，一次请求。
 *
 * 页面是 Next.js App Router：标题取 og:title（去掉「| 金髪洋物専門…」站名后缀），
 * 模特与类别取作品信息区的链接，封面取 og:image；配信日与时长在首屏 HTML 里是骨架屏占位，
 * 只能从页面内嵌的 RSC 数据（self.__next_f）里按字段名取 ecp_start_date / duration（秒）。
 * 作品不存在时站点回 404。站点要求 Accept 带 text/html，否则同一地址也回 404。
 * 行为参考 Amane 的 kin8 爬虫，代码独立实现。
 */
import { load } from '../../../../../shared/html/cheerio'
import type { JavCode } from '../number'
import { absolute, clean, unique } from '../html'
import type { JavRecord, JavSite, JavSiteId, SiteContext } from '../types'

export const KIN8_BASE = 'https://www.kin8tengoku.com'

const SITE_ID = 'kin8' as JavSiteId

/** KIN8-3997 / KIN8TENGOKU-123 → 4 位编号；不是本站番号或编号越界返回 undefined。 */
export function kin8Id(code: string): string | undefined {
  const m = /^KIN8(?:TENGOKU)?[-_ ]?(\d{1,4})$/i.exec(code.trim())
  if (!m || Number(m[1]) === 0) return undefined
  return m[1].padStart(4, '0')
}

/** 内嵌 RSC 数据里某个字段的原始值（数据是转义过的 JSON 字符串，引号前可能带反斜杠）。 */
function rscField(html: string, key: string): string | undefined {
  const m = new RegExp(`\\\\?"${key}\\\\?":\\\\?"?([^"\\\\,}]+)`).exec(html)
  return m?.[1]
}

/** 解析详情页；没有标题返回 null。 */
export function parseKin8Detail(
  html: string,
  url: string,
  id: string
): JavRecord | null {
  const $ = load(html)
  const meta = (name: string): string | undefined =>
    clean(
      $(`meta[property="${name}"]`).attr('content') ??
        $(`meta[name="${name}"]`).attr('content')
    )
  const fullTitle = meta('og:title') ?? clean($('title').first().text())
  const title = clean(fullTitle?.split('|')[0])
  if (!title) return null
  const links = (selector: string): string[] =>
    unique(
      $(selector)
        .map((_, a) => clean($(a).text()))
        .get()
    )
  const seconds = Number(rscField(html, 'duration'))
  const started = /^\$D(\d{4}-\d{2}-\d{2})/.exec(
    rscField(html, 'ecp_start_date') ?? ''
  )?.[1]
  return {
    site: SITE_ID,
    code: `KIN8-${id}`,
    url,
    title,
    releaseDate: started,
    runtimeMinutes: seconds > 0 ? Math.round(seconds / 60) : undefined,
    studio: '金髪天國',
    tags: links('[class^="Movie_Detail_actor-type"] a'),
    actors: links('[class^="Movie_Detail_actor_"] a').map(name => ({ name })),
    overview:
      clean($('[class^="Movie_Detail_memo"]').first().text()) ??
      meta('og:description'),
    cover: absolute(url, meta('og:image')),
    stills: [],
  }
}

/** 金髪天國站点。 */
export const kin8: JavSite = {
  id: SITE_ID,
  supports: kind => kind === 'uncensored',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const id = kin8Id(target.code)
    if (!id) return null
    const url = `${KIN8_BASE}/movie/${id}`
    const html = await ctx.page(url)
    return html ? parseKin8Detail(html, url, id) : null
  },
}
