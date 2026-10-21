/**
 * AVSOX（avsox.click）：无码片库。页面是 Vue 单页应用（静态 HTML 里没有影片数据），数据走站内 JSON 接口：
 *
 *   POST /javu/data/api/search    body [{"search":<番号>,"lang":"cn"}, 60, 1] → 候选列表（movieId + movieFanHao）
 *   POST /javu/data/api/getMovie  body [<movieId>, "cn"]                      → 详情（演员、类别、制作商…已展开成名字）
 *
 * - 响应外层是 { code, data }，code 不是 200（如 404 Resource not found）按没有处理；
 * - 番号先找写法完全一致的（010120-001 与 010120_001 在站上是两部片），再退到归一后相等且唯一的；
 * - 名字字段按语言有 xxxName / xxxName_ja / _en / _cn / _tw，接口已按 lang 选好 xxxName，空时依次回退；
 * - 演员带方形头像 avatarUrl；posterLarge 是横版封面，posterSmall 是小图（站点叫 poster，按海报用）；
 * - 接口目前不校验 CSRF（Amane 先取首页 csrf-token 再请求；实测不带也通过，省掉这次请求）。
 * 只查无码。行为参考 Amane 的 avsox 爬虫，代码独立实现。
 */
import { codeKey } from '../number'
import type { JavCode } from '../number'
import { clean, dateOf, list, str, unique } from '../html'
import type {
  JavActor,
  JavRecord,
  JavSite,
  JavSiteId,
  PageOptions,
  SiteContext,
} from '../types'

export const AVSOX_BASE = 'https://avsox.click'
const SITE_ID: JavSiteId = 'avsox'
/** 接口语言：简体中文（类别有中文名），标题没有中文时接口自己回退日文。 */
const LANG = 'cn'
/** 一页候选数：同番号的条目很少，取站点前端默认的 60。 */
const PAGE_SIZE = 60

type Obj = Record<string, unknown>

/** 接口请求选项（JSON POST）。 */
export function avsoxApiOptions(
  payload: unknown,
  referer: string
): PageOptions {
  return {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: AVSOX_BASE,
      Referer: referer,
    },
  }
}

/** 拆接口外层 { code: 200, data }；其它情况（404、坏 JSON 之外的结构）返回 undefined。 */
export function avsoxData(text: string | null): unknown {
  if (!text) return undefined
  const envelope = JSON.parse(text) as unknown
  if (!envelope || typeof envelope !== 'object') return undefined
  const { code, data } = envelope as { code?: unknown; data?: unknown }
  return code === 200 ? data : undefined
}

/** 候选列表里番号对得上的 movieId：写法一致优先，其次归一后相等且唯一。 */
export function pickAvsoxMovie(
  data: unknown,
  code: string
): string | undefined {
  if (!Array.isArray(data)) return undefined
  const key = codeKey(code)
  const loose: string[] = []
  for (const item of data as unknown[]) {
    const found = str(item, 'movieFanHao')
    const id = str(item, 'movieId')
    if (!found || !id) continue
    if (found.toUpperCase() === code.toUpperCase()) return id
    if (codeKey(found) === key) loose.push(id)
  }
  const hits = unique(loose)
  return hits.length === 1 ? hits[0] : undefined
}

/** 具名对象的名字：xxxName（接口按 lang 选好的）→ 各语言字段依次回退。 */
function nameOf(entity: unknown, prefix: string): string | undefined {
  // 少数条目把单个对象包成数组
  const obj = Array.isArray(entity) ? (entity[0] as unknown) : entity
  for (const suffix of ['', '_ja', '_cn', '_tw', '_en']) {
    const value = str(obj, `${prefix}Name${suffix}`)
    if (value) return value
  }
  return undefined
}

/** 首个非空字符串字段。 */
function firstOf(obj: unknown, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = str(obj, key)
    if (value) return value
  }
  return undefined
}

/** getMovie 的 data → 记录；没有番号返回 null。 */
export function avsoxRecord(movie: unknown, url: string): JavRecord | null {
  if (!movie || typeof movie !== 'object') return null
  const m = movie as Obj
  const code = str(m, 'movieFanHao')
  if (!code) return null
  const actors: JavActor[] = []
  for (const star of list(m, 'star')) {
    const name = nameOf(star, 'star')
    if (!name || actors.some(a => a.name === name)) continue
    const photo = star.hasAvatar === 0 ? undefined : str(star, 'avatarUrl')
    actors.push({ name, ...(photo ? { photo } : {}) })
  }
  const runtime =
    typeof m.length === 'number' && m.length > 0 ? m.length : undefined
  const samples = Array.isArray(m.sampleLarge)
    ? (m.sampleLarge as unknown[])
    : []
  return {
    site: SITE_ID,
    code,
    url,
    title: firstOf(m, [
      'title',
      'title_ja',
      'title_cn',
      'title_tw',
      'title_en',
    ]),
    releaseDate: dateOf(str(m, 'releaseDate')),
    runtimeMinutes: runtime,
    director: nameOf(m.director, 'director'),
    studio: nameOf(m.studio, 'studio'),
    label: nameOf(m.label, 'label'),
    series: nameOf(m.series, 'series'),
    tags: unique(list(m, 'genre').map(g => nameOf(g, 'genre'))),
    actors,
    overview: firstOf(m, [
      'description',
      'description_cn',
      'description_ja',
      'description_tw',
      'description_en',
    ]),
    cover: str(m, 'posterLarge'),
    poster: str(m, 'posterSmall'),
    stills: unique(
      samples.map(s => (typeof s === 'string' ? clean(s) : undefined))
    ),
  }
}

/** AVSOX 站点。 */
export const avsox: JavSite = {
  id: SITE_ID,
  supports: kind => kind === 'uncensored',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const searchReferer = `${AVSOX_BASE}/${LANG}/search/${encodeURIComponent(target.code)}`
    const found = avsoxData(
      await ctx.page(
        `${AVSOX_BASE}/javu/data/api/search`,
        avsoxApiOptions(
          [{ search: target.code, lang: LANG }, PAGE_SIZE, 1],
          searchReferer
        )
      )
    )
    const id = pickAvsoxMovie(found, target.code)
    if (!id) return null
    const url = `${AVSOX_BASE}/${LANG}/movies/${id}`
    const movie = avsoxData(
      await ctx.page(
        `${AVSOX_BASE}/javu/data/api/getMovie`,
        avsoxApiOptions([id, LANG], url)
      )
    )
    return avsoxRecord(movie, url)
  },
}
