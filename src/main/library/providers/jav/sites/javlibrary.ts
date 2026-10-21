/**
 * JAVLibrary（www.javlibrary.com）：识别码搜索 /<语言>/vl_searchbyid.php?keyword=<番号>。
 *
 * - 只有一条结果时站点直接 302 到详情页，取回来的就是详情页（fetch 跟随重定向），省掉一次请求；
 *   多条时是缩略图列表 div.video（div.id 是识别码），核对出唯一一条再取详情；
 *   同一识别码对应多部片（不同厂牌的 CKD-02 等）时放弃，猜错等于把别的片写成这个番号；
 * - 详情页字段按 div#video_id / #video_date / #video_length / … 的 id 取，与语言版本无关；
 *   语言只影响类别、标题等文字（cn 简体 / tw 繁体 / ja 日文 / en 英文），默认 cn；
 * - 详情页地址取 canonical（重定向后拿不到最终 URL）；
 * - 没有剧照（详情页的剧照区由脚本异步加载）、没有演员头像；
 * - 标题去掉开头的识别码和末尾的演员名（站点把演员名拼在标题后面）；
 * - 只有有码片；整站在 Cloudflare 后面，挑战页由上层熔断跳过。
 * 行为参考 Amane 的 javlibrary 爬虫，代码独立实现。
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
  JavRecord,
  JavSite,
  JavSiteId,
  PageOptions,
  SiteContext,
} from '../types'

export const JAVLIBRARY_BASE = 'https://www.javlibrary.com'
const SITE_ID: JavSiteId = 'javlibrary'

/** 站点语言版本（URL 第一段）。 */
export type JavlibraryLanguage = 'cn' | 'tw' | 'ja' | 'en'

const ACCEPT_LANGUAGE: Record<JavlibraryLanguage, string> = {
  cn: 'zh-CN,zh;q=0.9',
  tw: 'zh-TW,zh;q=0.9',
  ja: 'ja,en;q=0.8',
  en: 'en-US,en;q=0.9',
}

/** over18 跳过年龄确认。 */
function pageOptions(language: JavlibraryLanguage): PageOptions {
  return {
    cookie: 'over18=18',
    headers: { 'Accept-Language': ACCEPT_LANGUAGE[language] },
  }
}

/** 识别码搜索地址。 */
export function javlibrarySearchUrl(
  code: string,
  language: JavlibraryLanguage = 'cn'
): string {
  return `${JAVLIBRARY_BASE}/${language}/vl_searchbyid.php?keyword=${encodeURIComponent(code)}`
}

/** 是详情页吗（搜索被直接重定向到详情时用它分辨）。 */
export function isJavlibraryDetail(html: string): boolean {
  return /id="video_id"/.test(html)
}

/** 详情页某个信息块（div#video_xxx）里 td.text 的文字。 */
function infoText($: CheerioAPI, id: string): string | undefined {
  return clean($(`div#${id} td.text`).first().text())
}

/** 信息块里的链接文字（多个）。 */
function infoLinks($: CheerioAPI, selector: string): string[] {
  return unique(
    $(selector)
      .map((_, a) => clean($(a).text()))
      .get()
  )
}

/** 标题去掉开头识别码与末尾演员名。 */
function titleOf(
  heading: string | undefined,
  code: string,
  actors: string[]
): string | undefined {
  if (!heading) return undefined
  let title = heading
  if (title.toUpperCase().startsWith(code.toUpperCase())) {
    title = title.slice(code.length).trim()
  }
  // 演员名按页面顺序拼在末尾：从后往前逐个剥掉
  for (const name of [...actors].reverse()) {
    if (title.endsWith(` ${name}`))
      title = title.slice(0, -name.length - 1).trim()
  }
  return clean(title) ?? heading
}

/**
 * 解析详情页；不是详情页返回 null。
 *
 * @param url 请求地址（页面 canonical 缺失时用它）
 */
export function parseJavlibraryDetail(
  html: string,
  url: string
): JavRecord | null {
  const $ = load(html)
  const code = infoText($, 'video_id')
  if (!code) return null
  const canonical = absolute(url, $('link[rel="canonical"]').attr('href'))
  const actors = infoLinks($, 'div#video_cast span.star a')
  const cover = absolute(url, $('img#video_jacket_img').attr('src'))
  return {
    site: SITE_ID,
    code,
    url: canonical ?? url,
    title: titleOf(clean($('#video_title h3 a').first().text()), code, actors),
    releaseDate: dateOf(infoText($, 'video_date')),
    runtimeMinutes: minutesOf(
      clean($('div#video_length span.text').first().text())
    ),
    director: infoLinks($, 'div#video_director td.text a')[0],
    studio: infoLinks($, 'div#video_maker td.text a')[0],
    label: infoLinks($, 'div#video_label td.text a')[0],
    tags: infoLinks($, 'div#video_genres span.genre a'),
    actors: actors.map(name => ({ name })),
    cover: cover && !isPlaceholder(cover) ? cover : undefined,
    // 剧照区 div#video_images 由脚本异步填充，静态页里是空的
    stills: [],
  }
}

/**
 * 解析识别码搜索的结果列表：返回识别码对得上的唯一详情页地址。
 * 写法完全一致的优先；对得上的不止一部片时返回 undefined。
 *
 * @param pageUrl 搜索页地址（结果链接是相对的 ./?v=xxx）
 */
export function pickJavlibrarySearch(
  html: string,
  code: string,
  pageUrl: string
): string | undefined {
  const $ = load(html)
  const exact: string[] = []
  const loose: string[] = []
  const key = codeKey(code)
  $('div.videos div.video > a').each((_, a) => {
    const href = absolute(pageUrl, $(a).attr('href'))
    const found = clean($(a).find('div.id').first().text())
    if (!href || !found) return
    if (found.toUpperCase() === code.toUpperCase()) exact.push(href)
    else if (codeKey(found) === key) loose.push(href)
  })
  const hits = unique(exact.length ? exact : loose)
  return hits.length === 1 ? hits[0] : undefined
}

/** 站点参数。 */
export interface JavlibraryOptions {
  /** 语言版本，默认 cn（简体中文类别名）。 */
  language?: JavlibraryLanguage
}

/** 创建 JAVLibrary 站点。 */
export function createJavlibrary(options: JavlibraryOptions = {}): JavSite {
  const language = options.language ?? 'cn'
  const opts = pageOptions(language)
  return {
    id: SITE_ID,
    supports: kind => kind === 'censored',
    async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
      const searchUrl = javlibrarySearchUrl(target.code, language)
      const page = await ctx.page(searchUrl, opts)
      if (!page) return null
      if (isJavlibraryDetail(page)) {
        const record = parseJavlibraryDetail(page, searchUrl)
        // 直接跳转的详情也要核对：站点的「唯一结果」可能是前缀相近的另一部
        return record && codeKey(record.code) === codeKey(target.code)
          ? record
          : null
      }
      const url = pickJavlibrarySearch(page, target.code, searchUrl)
      if (!url) return null
      const detail = await ctx.page(url, opts)
      return detail ? parseJavlibraryDetail(detail, url) : null
    },
  }
}

/** 默认（简体中文）JAVLibrary 站点。 */
export const javlibrary: JavSite = createJavlibrary()
