/**
 * ThePornDB（api.theporndb.net）：带令牌的 REST JSON 接口，按番号检索条目。
 *
 * - 可选站点：令牌由调用方注入（设置里填），没填时 supports 一律返回 false，等于不启用；
 * - 令牌只放在 Authorization 请求头里，不进 URL，本模块也不输出任何日志；
 * - 有码查 /jav，其它类别查 /scenes（与 Amane 的类别映射一致），都是 `?q=<番号>` 一次请求，
 *   检索结果已含详情字段，不再逐条取详情；
 * - 检索是模糊匹配，逐条核对 sku / external_id / 标题开头的番号，归一后完全相等才采用，
 *   对不上就当作没有（不回退到第一条，猜错等于把别的片写成这个番号）。
 *
 * Amane 走的是 theporndb.net/graphql（stash-box，POST）；番号站点上下文只有 GET，这里改用
 * 同一数据库的 REST 接口。行为参考 Amane 的 theporndb 爬虫，代码独立实现。
 */
import { codeKey } from '../number'
import type { JavCode, JavCodeKind } from '../number'
import { clean, dateOf, list, str, unique } from '../html'
import type { JavActor, JavRecord, JavSite, SiteContext } from '../types'

export const TPDB_API = 'https://api.theporndb.net'
export const TPDB_WEB = 'https://theporndb.net'

type Obj = Record<string, unknown>

/** 一次检索取多少条：同番号的条目很少，10 条足够核对。 */
const PER_PAGE = 10

/** 番号类别 → 检索的接口（有码在 JAV 库，其余在 scene 库）。 */
const ENDPOINT: Record<JavCodeKind, 'jav' | 'scenes'> = {
  censored: 'jav',
  uncensored: 'scenes',
  amateur: 'scenes',
  fc2: 'scenes',
}

/** 检索地址（不含令牌）。 */
export function tpdbSearchUrl(code: JavCode): string {
  const q = encodeURIComponent(code.code)
  return `${TPDB_API}/${ENDPOINT[code.kind]}?q=${q}&per_page=${PER_PAGE}`
}

/** 标题开头的番号（JAV 条目的标题常写成「SSIS-497 ……」）。 */
function leadingCode(title: string | undefined): string | undefined {
  return title ? /^\s*\[?([A-Za-z0-9]+[-_]?\d+)\b/.exec(title)?.[1] : undefined
}

/** 条目上可能写着番号的字段，按可信度排。 */
function codesOf(scene: Obj): string[] {
  return unique([
    str(scene, 'sku'),
    str(scene, 'external_id'),
    leadingCode(str(scene, 'title')),
  ])
}

/** 条目上与番号对得上的那个写法；对不上返回 undefined。 */
export function tpdbMatchedCode(scene: Obj, code: string): string | undefined {
  const key = codeKey(code)
  return codesOf(scene).find(c => codeKey(c) === key)
}

/** 检索结果里挑番号对得上的第一条。 */
export function pickTpdbScene(scenes: Obj[], code: string): Obj | undefined {
  return scenes.find(s => tpdbMatchedCode(s, code))
}

/** 图片对象（{ full, large, medium, small }）里取最清晰的一张。 */
function bestImage(obj: unknown): string | undefined {
  return (
    str(obj, 'full') ??
    str(obj, 'large') ??
    str(obj, 'medium') ??
    str(obj, 'small')
  )
}

/** 演员：优先用主档（parent）的名字与头像。 */
function actorsOf(scene: Obj): JavActor[] {
  const out = new Map<string, JavActor>()
  for (const p of list(scene, 'performers')) {
    const parent =
      p.parent && typeof p.parent === 'object' ? p.parent : undefined
    const name = str(parent, 'name') ?? str(p, 'name')
    if (!name || out.has(name)) continue
    const photo =
      str(parent, 'image') ??
      str(p, 'image') ??
      str(p, 'face') ??
      str(p, 'thumbnail')
    out.set(name, { name, ...(photo ? { photo } : {}) })
  }
  return [...out.values()]
}

/** 时长：接口给秒，换成分钟；缺省 / 0 为 undefined。 */
function minutesOfSeconds(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0
    ? Math.round(value / 60) || undefined
    : undefined
}

/** 条目在 ThePornDB 网站上的地址。 */
function webUrl(scene: Obj): string {
  const kind = str(scene, 'type')?.toLowerCase() === 'jav' ? 'jav' : 'scenes'
  const id = str(scene, 'slug') ?? str(scene, 'id') ?? ''
  return `${TPDB_WEB}/${kind}/${encodeURIComponent(id)}`
}

/** 条目 JSON → 站点结果；番号对不上返回 null。 */
export function tpdbRecord(scene: Obj, code: string): JavRecord | null {
  const matched = tpdbMatchedCode(scene, code)
  if (!matched) return null
  const site =
    scene.site && typeof scene.site === 'object' ? scene.site : undefined
  return {
    site: 'theporndb',
    code: matched,
    url: webUrl(scene),
    title: str(scene, 'title'),
    releaseDate: dateOf(str(scene, 'date')),
    runtimeMinutes: minutesOfSeconds(scene.duration),
    director: list(scene, 'directors')
      .map(d => str(d, 'name'))
      .find(Boolean),
    studio: str(site, 'name'),
    tags: unique(list(scene, 'tags').map(t => str(t, 'name'))),
    actors: actorsOf(scene),
    overview: clean(str(scene, 'description')),
    cover: bestImage(scene.background) ?? str(scene, 'image'),
    poster: bestImage(scene.posters) ?? str(scene, 'poster'),
    stills: [],
  }
}

/** 检索应答 → 条目数组；坏数据返回空数组。 */
export function tpdbScenes(text: string | null): Obj[] {
  if (!text) return []
  try {
    return list(JSON.parse(text) as unknown, 'data')
  } catch {
    return []
  }
}

/**
 * 创建 ThePornDB 站点。
 *
 * @param token 每次查询时读取当前令牌；返回空值时站点不参与查询
 */
export function createThePornDb(token: () => string | undefined): JavSite {
  const current = (): string | undefined => token()?.trim() || undefined
  return {
    id: 'theporndb',
    supports: () => Boolean(current()),
    async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
      const value = current()
      if (!value) return null
      const text = await ctx.page(tpdbSearchUrl(target), {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${value}`,
        },
      })
      const scene = pickTpdbScene(tpdbScenes(text), target.code)
      return scene ? tpdbRecord(scene, target.code) : null
    },
  }
}
