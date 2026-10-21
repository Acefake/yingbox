/**
 * FreeJavBT（freejavbt.com）：详情页地址就是 /<番号>，先直取，取不到再走站内搜索并核对番号。
 *
 * - 不带语言前缀时是繁体中文页（x-default）：类别与 JavBus 同一套中文写法；
 *   标题多为中文译名，老片是日文原题；
 * - 番号写法：FC2 记作 FC2-<数字>（没有 PPV）；素人片两种都有（259LUXU-1200、LUXU-1234），
 *   所以素人番号先试原写法，再试去掉数字前缀的写法；
 * - 查无此片时站点返回「猜你喜歡」推荐页（HTTP 200），以没有影片信息区判定；
 * - 信息区每行「標籤:&nbsp;值」，按链接路径（/director/ /publisher/ /series/ /genre/）取值更稳，
 *   不依赖标签文字；演员占位「暫無女優資料」不算演员。
 *
 * 行为参考 Amane 的 freejavbt 爬虫，代码独立实现（Amane 的选择器已与现站不符，按现站页面重写）。
 */
import { type CheerioAPI, load } from 'cheerio'
import type { JavCode } from '../number'
import {
  absolute,
  clean,
  dateOf,
  isPlaceholder,
  minutesOf,
  unique,
} from '../html'
import type { JavRecord, JavSite, SiteContext } from '../types'
import { sameCode } from './same-code'

export const FREEJAVBT_BASE = 'https://freejavbt.com'

/** 演员栏的占位文字。 */
const NO_ACTOR = /暫無|暂无|N\/A/

/** FC2-PPV-1234567 → FC2-1234567（站点写法）；其他番号原样。 */
function siteCode(code: string): string {
  const fc2 = /^FC2-PPV-(\d+)$/i.exec(code)
  return fc2 ? `FC2-${fc2[1]}` : code
}

/** 要直取的番号写法，按命中概率排序：素人番号多试一个去掉数字前缀的写法。 */
export function freejavbtCandidates(target: JavCode): string[] {
  const primary = siteCode(target.code)
  const bare =
    target.kind === 'amateur' ? primary.replace(/^\d+(?=[A-Z])/i, '') : primary
  return unique([primary, bare])
}

/** 影片信息区（详情页才有）。 */
const INFO = '.single-video-info'

/** 信息区里标签（行内第一个 span）匹配 label 的那一行，去掉标签后的纯文本。 */
function rowText($: CheerioAPI, label: RegExp): string | undefined {
  const row = $(`${INFO} .single-video-meta`)
    .filter((_, el) => label.test($(el).children('span').first().text()))
    .first()
  if (!row.length) return undefined
  const copy = row.clone()
  copy.children('span').first().remove()
  return clean(copy.text())
}

/** 信息区里指向某类列表页的链接文本（去重保序），如 /genre/、/series/。 */
function linkTexts($: CheerioAPI, ...paths: string[]): string[] {
  const selector = paths.map(p => `${INFO} a[href*="${p}"]`).join(', ')
  return unique(
    $(selector)
      .map((_, a) => clean($(a).text()))
      .get()
  )
}

/** 标题：h1 去掉开头的番号与结尾的「免費AV在線看」类站点后缀。 */
function titleOf(
  heading: string | undefined,
  code: string
): string | undefined {
  if (!heading) return undefined
  let title = heading
  const first = title.split(' ')[0]
  if (first && sameCode(first, code)) title = title.slice(first.length)
  title = title.replace(/\s*(?:免費|免费|無料)\S*$/, '')
  return clean(title)
}

/** 解析详情页；不是详情页（推荐页 / 没有番号）返回 null。 */
export function parseFreejavbtDetail(
  html: string,
  url: string
): JavRecord | null {
  const $ = load(html)
  if (!$(INFO).length) return null
  const code = rowText($, /番號|番号|品番/)?.replace(/\s+/g, '')
  if (!code) return null
  const cover = absolute(
    url,
    clean($('meta[property="og:image"]').first().attr('content')) ??
      $('video[poster]').first().attr('poster')
  )
  return {
    site: 'freejavbt',
    code,
    url,
    title: titleOf(clean($('h1').first().text()), code),
    releaseDate: dateOf(rowText($, /日期|発売日|發行|发行/)),
    runtimeMinutes: minutesOf(rowText($, /時長|时长|収録時間/)),
    director: linkTexts($, '/director/')[0],
    studio: linkTexts($, '/maker/', '/studio/')[0],
    label: linkTexts($, '/publisher/', '/label/')[0],
    series: linkTexts($, '/series/')[0],
    tags: linkTexts($, '/genre/'),
    actors: unique(
      $(`${INFO} a.actress`)
        .map((_, a) => clean($(a).text()))
        .get()
    )
      .filter(name => !NO_ACTOR.test(name))
      .map(name => ({ name })),
    cover: cover && !isPlaceholder(cover) ? cover : undefined,
    stills: unique(
      $('.preview a.tile-item')
        .map((_, a) => absolute(url, $(a).attr('href')))
        .get()
    ),
  }
}

/** 解析搜索结果页：返回链接末段与番号对得上的第一条详情页地址（广告外链自然对不上）。 */
export function pickFreejavbtSearch(
  html: string,
  code: string
): string | undefined {
  const $ = load(html)
  for (const item of $('.video-list-item').toArray()) {
    const href = absolute(FREEJAVBT_BASE, $(item).find('a[href]').attr('href'))
    if (!href) continue
    const { hostname, pathname } = new URL(href)
    if (hostname !== new URL(FREEJAVBT_BASE).hostname) continue
    const last = decodeURIComponent(
      pathname.replace(/\/+$/, '').split('/').pop() ?? ''
    )
    if (last && sameCode(last, code)) return href
  }
  return undefined
}

/** 取一个详情页并核对番号（站点偶尔把相近番号的页面给过来）。 */
async function detail(
  url: string,
  code: string,
  ctx: SiteContext
): Promise<JavRecord | null> {
  const html = await ctx.page(url)
  const record = html ? parseFreejavbtDetail(html, url) : null
  return record && sameCode(record.code, code) ? record : null
}

/** FreeJavBT 站点。 */
export const freejavbt: JavSite = {
  id: 'freejavbt',
  supports: () => true,
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const candidates = freejavbtCandidates(target)
    for (const code of candidates) {
      const record = await detail(
        `${FREEJAVBT_BASE}/${encodeURIComponent(code)}`,
        code,
        ctx
      )
      if (record) return record
    }
    // 直取不中再搜一次（写法差异，如前导零）；FC2 / 素人已试过所有写法，不再多发请求
    if (target.kind === 'fc2' || target.kind === 'amateur') return null
    const search = await ctx.page(
      `${FREEJAVBT_BASE}/search/${encodeURIComponent(target.code)}`
    )
    const url = search ? pickFreejavbtSearch(search, target.code) : undefined
    const tried = candidates.map(
      c => `${FREEJAVBT_BASE}/${encodeURIComponent(c)}`
    )
    return url && !tried.includes(url) ? detail(url, target.code, ctx) : null
  },
}
