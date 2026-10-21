/**
 * R18.dev（r18.dev）：FANZA 目录的镜像，提供逐番号的公开 JSON 接口，不用解析网页、不需要令牌。
 *
 * 查询两步：
 * 1. `/videos/vod/movies/detail/-/dvd_id=<番号>/json`：按 DVD 番号精确查，拿到 content_id（404 即没有）；
 * 2. `/videos/vod/movies/detail/-/combined=<content_id>/json`：完整条目（日英双语标题、演员、类别、剧照）。
 * 只有数字版、没有 DVD 番号的片第 1 步查不到，这时按 DMM 的 content_id 写法（前缀 + 5 位补零数字）
 * 直接试一次第 2 步。条目的 dvd_id / content_id 必须与番号归一后相等才采用。
 *
 * 字段一律日文优先、英文兜底（英文多为机翻）。只收录 FANZA 有码片：无码、FC2、素人不查。
 *
 * Amane 用的是 r18.dev 发布的整库 PostgreSQL 转储（需自备 PG、GB 级下载），这里只用在线接口。
 * 行为参考 Amane 的 r18dev 爬虫（字段含义、图片地址规则），代码独立实现。
 */
import { codeKey } from '../number'
import type { JavCode } from '../number'
import { clean, dateOf, list, str, unique } from '../html'
import type { JavActor, JavRecord, JavSite, SiteContext } from '../types'

export const R18DEV_BASE = 'https://r18.dev'

/** DMM 演员头像目录（条目里只给文件名）。 */
const ACTRESS_PHOTO_BASE = 'https://pics.dmm.co.jp/mono/actjpgs/'

type Obj = Record<string, unknown>

/** 接口要的是 JSON，覆盖上下文默认的 HTML Accept。 */
const JSON_HEADERS = { headers: { Accept: 'application/json' } }

/** 按 DVD 番号查的接口地址。 */
export const r18DvdUrl = (code: string): string =>
  `${R18DEV_BASE}/videos/vod/movies/detail/-/dvd_id=${encodeURIComponent(code.toLowerCase())}/json`

/** 完整条目的接口地址。 */
export const r18CombinedUrl = (contentId: string): string =>
  `${R18DEV_BASE}/videos/vod/movies/detail/-/combined=${encodeURIComponent(contentId)}/json`

/** 条目的网页地址（记录里给用户看的详情页）。 */
export const r18PageUrl = (contentId: string): string =>
  `${R18DEV_BASE}/videos/vod/movies/detail/-/id=${encodeURIComponent(contentId)}/`

/**
 * 番号 → DMM content_id 的常见写法：前缀小写 + 数字补到 5 位（SSIS-497 → ssis00497）。
 * 只处理「字母-数字」的常规番号，其它写法返回 undefined。
 */
export function r18ContentId(code: string): string | undefined {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(code)
  if (!m) return undefined
  return `${m[1].toLowerCase()}${String(Number(m[2])).padStart(5, '0')}`
}

/** content_id 的比较键：去掉 DMM 的厂牌数字前缀（1sdmu00123、h_1234abc00012）。 */
const contentKey = (contentId: string): string =>
  codeKey(contentId.replace(/^(?:h_)?\d+/, ''))

/** 条目是不是这个番号：dvd_id 或 content_id 归一后相等。 */
export function r18Matches(entry: Obj, code: string): boolean {
  const key = codeKey(code)
  const dvd = str(entry, 'dvd_id')
  if (dvd && codeKey(dvd) === key) return true
  const cid = str(entry, 'content_id')
  return Boolean(cid && contentKey(cid) === key)
}

/** 日文优先、英文兜底。 */
function ja(obj: unknown, base: string): string | undefined {
  return str(obj, `${base}_ja`) ?? str(obj, `${base}_en`)
}

/** 人名：汉字优先，其次罗马字。 */
const personName = (p: Obj): string | undefined =>
  str(p, 'name_kanji') ?? str(p, 'name_romaji') ?? str(p, 'name_kana')

/** 女优在前、男优在后，按名字去重；女优带 DMM 头像。 */
function actorsOf(entry: Obj): JavActor[] {
  const out = new Map<string, JavActor>()
  for (const p of [...list(entry, 'actresses'), ...list(entry, 'actors')]) {
    const name = personName(p)
    if (!name || out.has(name)) continue
    const file = str(p, 'image_url')
    const photo = file
      ? /^https?:\/\//.test(file)
        ? file
        : `${ACTRESS_PHOTO_BASE}${file}`
      : undefined
    out.set(name, { name, ...(photo ? { photo } : {}) })
  }
  return [...out.values()]
}

/** 正整数分钟；缺省 / 0 为 undefined。 */
function minutes(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 ? Math.round(value) : undefined
}

/** combined 条目 JSON → 站点结果；没有 content_id 返回 null。 */
export function r18Record(entry: Obj, code: string): JavRecord | null {
  const contentId = str(entry, 'content_id')
  if (!contentId) return null
  const stills = list(entry, 'gallery').map(
    g => str(g, 'image_full') ?? str(g, 'image_thumb')
  )
  return {
    site: 'r18dev',
    code: str(entry, 'dvd_id') ?? code,
    url: r18PageUrl(contentId),
    title: ja(entry, 'title'),
    releaseDate: dateOf(str(entry, 'release_date')),
    runtimeMinutes: minutes(entry.runtime_mins),
    director: list(entry, 'directors').map(personName).find(Boolean),
    studio: ja(entry, 'maker_name'),
    label: ja(entry, 'label_name'),
    series: ja(entry, 'series_name'),
    tags: unique(list(entry, 'categories').map(c => ja(c, 'name'))),
    actors: actorsOf(entry),
    overview: clean(ja(entry, 'comment')),
    cover: str(entry, 'jacket_full_url'),
    poster: str(entry, 'jacket_thumb_url'),
    stills: unique(stills),
  }
}

/** 解析接口返回的 JSON 对象；空 / 坏数据返回 undefined。 */
export function parseObject(text: string | null): Obj | undefined {
  if (!text) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Obj)
      : undefined
  } catch {
    return undefined
  }
}

/** 取一个 combined 条目，番号对不上当作没有。 */
async function combined(
  ctx: SiteContext,
  contentId: string,
  code: string
): Promise<Obj | undefined> {
  const entry = parseObject(
    await ctx.page(r18CombinedUrl(contentId), JSON_HEADERS)
  )
  return entry && r18Matches(entry, code) ? entry : undefined
}

/** R18.dev 站点。 */
export const r18dev: JavSite = {
  id: 'r18dev',
  supports: kind => kind === 'censored',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const byDvd = parseObject(
      await ctx.page(r18DvdUrl(target.code), JSON_HEADERS)
    )
    const found = str(byDvd, 'content_id')
    if (found) {
      const entry = await combined(ctx, found, target.code)
      if (entry) return r18Record(entry, target.code)
    }
    // 没有 DVD 番号的数字版：按 content_id 写法直接试一次（与上一步同一 id 时不重复请求）
    const guess = r18ContentId(target.code)
    if (!guess || guess === found) return null
    const entry = await combined(ctx, guess, target.code)
    return entry ? r18Record(entry, target.code) : null
  },
}
