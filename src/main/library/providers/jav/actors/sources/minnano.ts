/**
 * みんなのAV（www.minnano-av.com）：日文女优资料库，生日 / 身材 / 出身地 / 别名最全。
 *
 * 检索 search_result.php?search_scope=actress；精确命中时站点直接 302 到资料页，
 * 这时就地解析，不再多发一次请求。否则在结果表里找标题（去掉注记括号后）与查找名相同的一行，
 * 确认不了就放弃，不回退首条。
 * 资料页 div.act-profile：h2 是「名前 （かな / ローマ字）」，每行 <span>键</span><p>值</p>，
 * 「別名」行可重复，サイズ 形如「T159 / B88(Gカップ) / W57 / H83」。
 * 年龄确认弹层靠预置 Cookie age_verified=1 跳过。站点在 Cloudflare 之后，海外 IP 常被挑战。
 * 行为参考 Amane 的 minnano 演员爬虫，代码独立实现。
 */
import type { CheerioAPI } from 'cheerio'
import { load } from '../../../../../../shared/html/cheerio'
import { absolute, clean } from '../../html'
import type { PageOptions } from '../../types'
import {
  calendarDate,
  normalizeName,
  sameName,
  stripAnnotations,
  uniqueNames,
} from '../names'
import type { ActorContext, ActorProfile, ActorSource } from '../types'

export const MINNANO_BASE = 'https://www.minnano-av.com'

const OPTIONS: PageOptions = { cookie: 'age_verified=1' }

/** 「名前 （かな / ローマ字）」；读音可为空（别名行常是「旧名 （ / ）」）。 */
const NAME_LINE =
  /^(.+?)\s*[（(]\s*([^/（）()]*?)\s*\/\s*([^/（）()]*?)\s*[）)]$/

/** 名字行 → [规范名, 读音们]。没有读音括号时整行即名字。 */
export function parseMinnanoName(raw: string): [string, string[]] {
  const text = normalizeName(raw)
  const m = NAME_LINE.exec(text)
  if (!m) return [stripAnnotations(text), []]
  return [stripAnnotations(m[1]), [m[2], m[3]].filter(Boolean)]
}

/** サイズ → 身高 / 三围 / 罩杯。 */
export function parseMinnanoFigure(raw: string | undefined): {
  height?: number
  bust?: number
  waist?: number
  hip?: number
  cup?: string
} {
  const text = (raw ?? '').normalize('NFKC')
  const num = (re: RegExp): number | undefined => {
    const m = re.exec(text)
    return m ? Number(m[1]) || undefined : undefined
  }
  const cup = /([A-Z]+)\s*カップ/i.exec(text)?.[1].toUpperCase()
  return {
    height: num(/T\s*(\d+)/i),
    bust: num(/B\s*(\d+)/i),
    waist: num(/W\s*(\d+)/i),
    hip: num(/H\s*(\d+)/i),
    ...(cup ? { cup } : {}),
  }
}

/** 资料表的「键 → 值」（同键取第一行）。 */
function profileFields($: CheerioAPI): Map<string, string> {
  const out = new Map<string, string>()
  $('div.act-profile tr').each((_, tr) => {
    const key = clean($(tr).find('td > span').first().text())
    const value = clean($(tr).find('td > p').first().text())
    if (key && value && !out.has(key)) out.set(key, value)
  })
  return out
}

/** 图片地址去掉查询串（?new 之类的缓存参数）。 */
function stable(url: string | undefined): string | undefined {
  return url?.split('?')[0]
}

/** 资料页 → 演员资料；不是资料页返回 null。 */
export function parseMinnanoProfile(
  html: string,
  pageUrl: string
): ActorProfile | null {
  const $ = load(html)
  const box = $('div.act-profile').first()
  if (!box.length) return null
  const [name, readings] = parseMinnanoName(box.find('h2').first().text())
  if (!name) return null

  const aliases: string[] = [...readings]
  box.find('tr').each((_, tr) => {
    if (clean($(tr).find('td > span').first().text()) !== '別名') return
    const [alias, aliasReadings] = parseMinnanoName(
      $(tr).find('td > p').first().text()
    )
    aliases.push(alias, ...aliasReadings)
  })

  const fields = profileFields($)
  const image =
    $('meta[property="og:image"]').attr('content') ??
    $('div.thumb img[src*="p_actress"]').attr('src')
  const url =
    $('link[rel="canonical"]').attr('href') ??
    $('meta[property="og:url"]').attr('content') ??
    pageUrl
  const imageUrl = stable(absolute(MINNANO_BASE, image))
  return {
    source: 'minnano',
    name,
    aliases: uniqueNames(aliases, name),
    gender: 'female',
    birthday: calendarDate(fields.get('生年月日')),
    birthplace: fields.get('出身地'),
    ...parseMinnanoFigure(fields.get('サイズ')),
    images: imageUrl ? [imageUrl] : [],
    ids: { minnano: /actress(\d+)\.html/.exec(url)?.[1] ?? url },
    url,
  }
}

/** 检索结果表里挑标题与查找名相同的资料页地址。 */
export function pickMinnanoSearch(
  html: string,
  name: string
): string | undefined {
  const $ = load(html)
  for (const a of $('table.tbllist.actress h2.ttl a').toArray()) {
    const href = $(a).attr('href')
    if (!href || !/actress\d+\.html/.test(href)) continue
    if (sameName(stripAnnotations($(a).text()), name))
      return absolute(`${MINNANO_BASE}/`, href.split('?')[0])
  }
  return undefined
}

export function minnanoSearchUrl(name: string): string {
  return `${MINNANO_BASE}/search_result.php?search_scope=actress&search_word=${encodeURIComponent(name)}&search=Go`
}

export const minnano: ActorSource = {
  id: 'minnano',
  label: 'みんなのAV',
  capability: 'profile',
  genders: ['female'],
  async fetch(name: string, ctx: ActorContext): Promise<ActorProfile | null> {
    if (!name.trim()) return null
    const searchUrl = minnanoSearchUrl(name.trim())
    const html = await ctx.page(searchUrl, OPTIONS)
    if (html === null) return null
    // 精确命中时已被重定向到资料页
    const direct = parseMinnanoProfile(html, searchUrl)
    if (direct) return direct
    const url = pickMinnanoSearch(html, name)
    if (!url) return null
    const page = await ctx.page(url, OPTIONS)
    return page === null ? null : parseMinnanoProfile(page, url)
  },
}
