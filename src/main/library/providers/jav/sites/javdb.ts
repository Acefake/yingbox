/**
 * JavDB（javdb.com）：先站内搜索 /search?q=<番号>&f=all，在结果里按番号核对出唯一一条，再取 /v/<id> 详情页。
 *
 * - 搜索结果与列表页同一套卡片：a.box 内 div.video-title > strong 是番号；
 * - 详情页信息在 nav.movie-panel-info 的 div.panel-block 里，「<strong>標籤:</strong><span class="value">」；
 *   番号取复制按钮的 data-clipboard-text（站上写法，无码日期型是下划线 020625_001）；
 * - 演员栏 ♀ / ♂ 标记性别，只取女优（没有任何性别标记时全取）；头像不额外请求，
 *   按演员 id 拼 jdbstatic 头像地址（/avatars/<id 前两位小写>/<id>.jpg，站内演员页用的就是它）；
 * - 页面用 locale=zh（繁体标签），Cookie 带 over18=1 跳过年龄确认；
 * - FC2 影片只对登录用户可见：没配置登录 Cookie 时不查 FC2；
 * - 站点在 Cloudflare 后面，部分地区（如美国机房）直接给挑战页，由上层熔断跳过。
 * 行为参考 Amane 的 javdb 爬虫，代码独立实现。
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
import type {
  JavActor,
  JavRecord,
  JavSite,
  JavSiteId,
  PageOptions,
  SiteContext,
} from '../types'

export const JAVDB_BASE = 'https://javdb.com'
const AVATAR_BASE = 'https://c0.jdbstatic.com/avatars'
const SITE_ID: JavSiteId = 'javdb'

/** 站点参数。 */
export interface JavdbOptions {
  /**
   * 每次查询时读取用户在设置里填的 Cookie（整段 "name=value; ..."，如登录后的 _jdb_session）。
   * 有值才查 FC2；也可放 cf_clearance（需与 UA 匹配，一般不建议）。
   */
  cookie?: () => string | undefined
}

/** 请求选项：固定的年龄确认 / 语言 Cookie + 用户 Cookie。 */
function pageOptions(userCookie: string | undefined): PageOptions {
  return {
    cookie: ['over18=1', 'locale=zh', userCookie].filter(Boolean).join('; '),
    headers: { 'Accept-Language': 'zh-TW,zh;q=0.9,ja;q=0.8' },
  }
}

/** 搜索地址。 */
export function javdbSearchUrl(code: string): string {
  return `${JAVDB_BASE}/search?q=${encodeURIComponent(code)}&f=all&locale=zh`
}

/**
 * 解析搜索结果：返回番号对得上的唯一详情页地址。
 * 写法完全一致的优先；只有归一后相等的（分隔符 / 前导零不同）且不唯一时放弃，猜错等于把别的片写成这个番号。
 */
export function pickJavdbSearch(
  html: string,
  code: string
): string | undefined {
  const $ = load(html)
  const exact: string[] = []
  const loose: string[] = []
  const key = codeKey(code)
  $('a.box').each((_, box) => {
    const href = absolute(JAVDB_BASE, $(box).attr('href'))
    const found = clean($(box).find('div.video-title strong').first().text())
    if (!href || !found) return
    if (found.toUpperCase() === code.toUpperCase()) exact.push(href)
    else if (codeKey(found) === key) loose.push(href)
  })
  const hits = unique(exact.length ? exact : loose)
  return hits.length === 1 ? hits[0] : undefined
}

/** 详情页里「標籤:」对应的 span.value；标签繁简都认。 */
function field(
  $: CheerioAPI,
  label: RegExp
): ReturnType<CheerioAPI> | undefined {
  const block = $('nav.movie-panel-info div.panel-block')
    .filter((_, el) => label.test($(el).children('strong').first().text()))
    .first()
  const value = block.children('span.value').first()
  return value.length ? value : undefined
}

/** span.value 里的链接文字（多个）。 */
function links($: CheerioAPI, label: RegExp): string[] {
  const value = field($, label)
  if (!value) return []
  return unique(
    value
      .find('a')
      .map((_, a) => clean($(a).text()))
      .get()
  )
}

/** 演员 id（/actors/vd5z → vd5z）→ jdbstatic 头像地址。 */
export function javdbAvatar(href: string | undefined): string | undefined {
  const id = href && /\/actors\/([A-Za-z0-9]+)/.exec(href)?.[1]
  return id
    ? `${AVATAR_BASE}/${id.slice(0, 2).toLowerCase()}/${id}.jpg`
    : undefined
}

/** 演员：女优优先（链接后紧跟 strong.symbol.female）；整栏没有性别标记时全取。 */
function actorsOf($: CheerioAPI): JavActor[] {
  const value = field($, /演員|演员|Actor/i)
  if (!value) return []
  const all: Array<JavActor & { female: boolean; marked: boolean }> = []
  value.find('a[href*="/actors/"]').each((_, a) => {
    const name = clean($(a).text())
    if (!name) return
    const symbol = $(a).next('strong.symbol')
    const photo = javdbAvatar($(a).attr('href'))
    all.push({
      name,
      ...(photo ? { photo } : {}),
      female: symbol.hasClass('female'),
      marked: symbol.length > 0,
    })
  })
  const picked = all.some(a => a.marked) ? all.filter(a => a.female) : all
  const seen = new Set<string>()
  return picked
    .filter(a => !seen.has(a.name) && Boolean(seen.add(a.name)))
    .map(({ name, photo }) => ({ name, ...(photo ? { photo } : {}) }))
}

/** 解析详情页；不是详情页（没有番号）返回 null。 */
export function parseJavdbDetail(html: string, url: string): JavRecord | null {
  const $ = load(html)
  const code = clean(
    $('a.copy-to-clipboard[data-clipboard-text]')
      .first()
      .attr('data-clipboard-text')
  )
  if (!code) return null
  const title =
    clean($('h2.title strong.current-title').first().text()) ??
    clean($('h2.title').first().text())
  const text = (label: RegExp): string | undefined =>
    clean(field($, label)?.text())
  const cover = absolute(url, $('img.video-cover').first().attr('src'))
  return {
    site: SITE_ID,
    code,
    url,
    title,
    releaseDate: dateOf(text(/日期|Released/i)),
    runtimeMinutes: minutesOf(text(/時長|时长|Duration/i)),
    director: links($, /導演|导演|Director/i)[0],
    studio: links($, /片商|Maker/i)[0],
    label: links($, /發行|发行|Publisher/i)[0],
    series: links($, /系列|Series/i)[0],
    tags: links($, /類別|类别|Tags/i),
    actors: actorsOf($),
    cover: cover && !isPlaceholder(cover) ? cover : undefined,
    stills: unique(
      $('div.preview-images a.tile-item')
        .map((_, a) => absolute(url, $(a).attr('href')))
        .get()
    ),
  }
}

/**
 * 创建 JavDB 站点。
 *
 * @param options.cookie 读取用户配置的登录 Cookie；缺省为没有
 */
export function createJavdb(options: JavdbOptions = {}): JavSite {
  const userCookie = (): string | undefined =>
    options.cookie?.()?.trim() || undefined
  return {
    id: SITE_ID,
    supports: kind => kind !== 'fc2' || Boolean(userCookie()),
    async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
      const opts = pageOptions(userCookie())
      const search = await ctx.page(javdbSearchUrl(target.code), opts)
      const url = search ? pickJavdbSearch(search, target.code) : undefined
      if (!url) return null
      const detail = await ctx.page(url, opts)
      return detail ? parseJavdbDetail(detail, url) : null
    },
  }
}

/** 未配置 Cookie 的 JavDB 站点（不查 FC2）。 */
export const javdb: JavSite = createJavdb()
