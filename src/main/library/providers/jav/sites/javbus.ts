/**
 * JavBus（www.javbus.com）：先直取 /<番号> 详情页，没有再走站内搜索并逐条核对番号。
 *
 * 详情页是繁体中文标签（識別碼 / 發行日期 / 長度 / 導演 / 製作商 / 發行商 / 系列 / 類別）；
 * 封面 /pics/cover/xxx_b.jpg 对应竖版缩略图 /pics/thumb/xxx.jpg（无码在 /imgs/cover → /imgs/thumbs）。
 * 图片校验同源 Referer，见 media-headers 与图片缓存。
 * 页面结构参考 Amane 的 javbus 爬虫行为，代码独立实现。
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
import type { JavRecord, JavSite, PageOptions, SiteContext } from '../types'

export const JAVBUS_BASE = 'https://www.javbus.com'

/** dv=1 跳过年龄确认，existmag=all 搜索时含无磁力的条目。 */
const OPTIONS: PageOptions = {
  cookie: 'dv=1; existmag=all',
  headers: { 'Accept-Language': 'zh-TW,zh;q=0.9,ja;q=0.8' },
}

/** 详情页里「標籤:」后面的值（文本或链接）。 */
function infoValue($: CheerioAPI, label: RegExp): string | undefined {
  const row = $('div.info p')
    .filter((_, p) => label.test($(p).find('span.header').first().text()))
    .first()
  if (!row.length) return undefined
  const linked = clean(row.find('a').first().text())
  if (linked) return linked
  const copy = row.clone()
  copy.find('span.header').remove()
  return clean(copy.text())
}

/** 封面地址 → 竖版缩略图地址。 */
export function javbusPoster(cover: string): string | undefined {
  if (/\/pics\/cover\//.test(cover)) {
    return cover
      .replace('/pics/cover/', '/pics/thumb/')
      .replace(/_b(\.\w+)$/, '$1')
  }
  if (/\/imgs\/cover\//.test(cover)) {
    return cover
      .replace('/imgs/cover/', '/imgs/thumbs/')
      .replace(/_b(\.\w+)$/, '$1')
  }
  return undefined
}

/** 解析详情页；不是详情页（没有标题或识别码）返回 null。 */
export function parseJavbusDetail(html: string, url: string): JavRecord | null {
  const $ = load(html)
  const heading = clean($('h3').first().text())
  const code = infoValue($, /識別碼|识别码/)
  if (!heading || !code) return null
  const title = heading.toUpperCase().startsWith(code.toUpperCase())
    ? clean(heading.slice(code.length))
    : heading
  const cover = absolute(url, $('a.bigImage').attr('href'))
  const photos = new Map<string, string>()
  $('div.star-box img').each((_, img) => {
    const name = clean($(img).attr('title'))
    const src = absolute(url, $(img).attr('src'))
    if (name && src && !isPlaceholder(src)) photos.set(name, src)
  })
  const actors = unique(
    $('div.star-name a')
      .map((_, a) => clean($(a).text()))
      .get()
  ).map(name => ({
    name,
    ...(photos.has(name) ? { photo: photos.get(name) } : {}),
  }))
  return {
    site: 'javbus',
    code,
    url,
    title: title || heading,
    releaseDate: dateOf(infoValue($, /發行日期|发行日期/)),
    runtimeMinutes: minutesOf(infoValue($, /長度|长度/)),
    director: clean($('div.info a[href*="/director/"]').first().text()),
    studio: clean($('div.info a[href*="/studio/"]').first().text()),
    label: clean($('div.info a[href*="/label/"]').first().text()),
    series: clean($('div.info a[href*="/series/"]').first().text()),
    tags: unique(
      $('span.genre label a[href*="/genre/"]')
        .map((_, a) => clean($(a).text()))
        .get()
    ),
    actors,
    cover,
    poster: cover ? javbusPoster(cover) : undefined,
    stills: unique(
      $('#sample-waterfall a.sample-box')
        .map((_, a) => absolute(url, $(a).attr('href')))
        .get()
    ),
  }
}

/** 解析搜索结果页：返回番号完全对得上的第一条详情页地址。 */
export function pickJavbusSearch(
  html: string,
  code: string
): string | undefined {
  const $ = load(html)
  const key = codeKey(code)
  let loose: string | undefined
  for (const box of $('a.movie-box').toArray()) {
    const href = absolute(JAVBUS_BASE, $(box).attr('href'))
    const found = clean($(box).find('date').first().text())
    if (!href || !found) continue
    if (found.toUpperCase() === code.toUpperCase()) return href
    if (!loose && codeKey(found) === key) loose = href
  }
  return loose
}

/** JavBus 站点。 */
export const javbus: JavSite = {
  id: 'javbus',
  supports: kind => kind !== 'fc2',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const direct = `${JAVBUS_BASE}/${encodeURIComponent(target.code)}`
    const page = await ctx.page(direct, OPTIONS)
    const record = page ? parseJavbusDetail(page, direct) : null
    if (record) return record
    const search = await ctx.page(
      `${JAVBUS_BASE}/search/${encodeURIComponent(target.code)}&type=&parent=ce`,
      OPTIONS
    )
    const url = search ? pickJavbusSearch(search, target.code) : undefined
    if (!url) return null
    const detail = await ctx.page(url, OPTIONS)
    return detail ? parseJavbusDetail(detail, url) : null
  },
}
