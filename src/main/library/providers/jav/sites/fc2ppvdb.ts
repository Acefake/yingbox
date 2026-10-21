/**
 * FC2PPVDB（2026 年中起迁到 fc2cmadb.com，原 fc2ppvdb.com 已停用）：FC2 番号对应 /articles/<数字>，只查 FC2。
 * 主要用来补 FC2 官方页没有的演员（网友补全）与标签。
 *
 * 站点是 Laravel + Inertia 应用，页面不渲染 HTML 正文，数据在内嵌的页面 JSON 里：
 * - 首屏 `<script data-page="app" type="application/json">`（旧版 Inertia 是 `<div id="app" data-page="…">`）
 *   的 props.article 带标题、发售日、时长、卖家（writer）、标签、主图；
 * - 演员是延迟加载的 props（deferredProps.default 含 actresses），要再发一次 Inertia 局部请求：
 *   同一地址带 X-Inertia / X-Inertia-Version（取首屏里的 version）/ X-Inertia-Partial-Component /
 *   X-Inertia-Partial-Data: actresses，返回 JSON。不需要登录；
 * - 不存在的作品返回 404（component 为 Error）。
 *
 * 行为参考 Amane 的 fc2ppvdb 爬虫（其 HTML 选择器已不适用新站），代码独立实现。
 */
import type { JavCode } from '../number'
import { dateOf, list, minutesOf, str, unique } from '../html'
import type { JavRecord, JavSite, SiteContext } from '../types'
import { fc2Id } from './fc2'

export const FC2PPVDB_BASE = 'https://fc2cmadb.com'

/** Inertia 页面对象里用到的部分。 */
export interface InertiaPage {
  component: string
  props: Record<string, unknown>
  version?: string
  /** 延迟加载的 props 名（各分组合并）。 */
  deferred: string[]
}

/** HTML 属性值反转义（只处理 Inertia 会产生的几种实体）。 */
function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** JSON 文本 → Inertia 页面对象；不是页面对象返回 undefined。 */
export function inertiaFromJson(text: string): InertiaPage | undefined {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!data || typeof data !== 'object') return undefined
  const page = data as Record<string, unknown>
  const component = str(page, 'component')
  const props = page.props
  if (!component || !props || typeof props !== 'object') return undefined
  const groups = page.deferredProps
  const deferred =
    groups && typeof groups === 'object'
      ? Object.values(groups as Record<string, unknown>).flatMap(v =>
          Array.isArray(v)
            ? v.filter((x): x is string => typeof x === 'string')
            : []
        )
      : []
  return {
    component,
    props: props as Record<string, unknown>,
    version: str(page, 'version'),
    deferred,
  }
}

/** 取 HTML 里内嵌的 Inertia 页面对象（新旧两种嵌法）。 */
export function inertiaFromHtml(html: string): InertiaPage | undefined {
  const script =
    /<script[^>]*data-page="app"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(
      html
    )
  if (script) return inertiaFromJson(script[1])
  const attr = /<div[^>]*\bid="app"[^>]*\bdata-page="([^"]*)"/.exec(html)
  return attr ? inertiaFromJson(unescapeAttr(attr[1])) : undefined
}

/** props.actresses → 演员名（去重保序）。 */
export function fc2ppvdbActresses(props: Record<string, unknown>): string[] {
  return unique(list(props, 'actresses').map(a => str(a, 'name')))
}

/** 从页面对象取作品；不是这部作品 / 已标记找不到返回 null。演员另行补上。 */
export function fc2ppvdbRecord(
  page: InertiaPage,
  url: string,
  id: string
): JavRecord | null {
  if (page.component !== 'Articles/Show') return null
  const article = page.props.article
  if (!article || typeof article !== 'object') return null
  const a = article as Record<string, unknown>
  if (String(a.video_id) !== id || a.not_found) return null
  const title = str(a, 'title')
  if (!title) return null
  const writer = a.writer
  return {
    site: 'fc2ppvdb',
    code: `FC2-PPV-${id}`,
    url,
    title,
    releaseDate: dateOf(str(a, 'release_date')),
    runtimeMinutes: minutesOf(str(a, 'duration')),
    studio: str(writer, 'name'),
    tags: unique(list(a, 'tags').map(t => str(t, 'name'))),
    actors: fc2ppvdbActresses(page.props).map(name => ({ name })),
    poster: str(a, 'image_url'),
    stills: [],
  }
}

/** Inertia 局部请求的请求头：只要 names 这几个 props。 */
function partialHeaders(
  page: InertiaPage,
  names: string[]
): Record<string, string> {
  return {
    Accept: 'text/html, application/xhtml+xml',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Inertia': 'true',
    ...(page.version ? { 'X-Inertia-Version': page.version } : {}),
    'X-Inertia-Partial-Component': page.component,
    'X-Inertia-Partial-Data': names.join(','),
  }
}

/** FC2PPVDB 站点。 */
export const fc2ppvdb: JavSite = {
  id: 'fc2ppvdb',
  supports: kind => kind === 'fc2',
  async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
    const id = fc2Id(target.code)
    if (!id) return null
    const url = `${FC2PPVDB_BASE}/articles/${id}`
    const html = await ctx.page(url)
    const page = html ? inertiaFromHtml(html) : undefined
    const record = page ? fc2ppvdbRecord(page, url, id) : null
    if (!page || !record) return null
    // 演员是延迟 props：首屏已带就直接用，否则补一次局部请求（失败照常抛错，下次重试，不缓存缺演员的结果）
    if (record.actors.length || !page.deferred.includes('actresses'))
      return record
    const partial = await ctx.page(url, {
      headers: partialHeaders(page, ['actresses']),
    })
    const extra = partial ? inertiaFromJson(partial) : undefined
    const actors = extra ? fc2ppvdbActresses(extra.props) : []
    return { ...record, actors: actors.map(name => ({ name })) }
  },
}
