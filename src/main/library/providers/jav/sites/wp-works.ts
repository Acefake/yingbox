/**
 * WordPress「works」主题厂商官网的通用实现（FALENO、DAHLIA 等）：站点差异只在一份配置里，
 * 由 createWpWorksSite 生成站点对象。
 *
 * 查询顺序：
 * 1. WP REST `/wp-json/wp/v2/works?slug=<slug>`：slug 精确匹配，空数组就是没有这部片；
 *    字段来自主题的 ACF（作品名 / 出演女優 / 作品紹介文 / 収録時間 / 発売日）与预生成的图片地址（横版 / 竖版 / 剧照）。
 * 2. REST 被拦（这类站点托管在 XSERVER，海外 IP 访问 wp-json 常回 403）时退到 HTML 详情页 `/works/<slug>/`。
 *    详情页对「前缀对但编号不存在」的 slug 会跳到别的作品，所以必须核对页面 canonical 里的 slug，
 *    对不上按没有处理。REST 被拦后 30 分钟内直接走 HTML，不再白发一次请求。
 * 只查配置里列出的番号前缀，其它番号不发请求。
 * 行为参考 Amane 的 wp_works / faleno / dahlia 爬虫，代码独立实现。
 */
import { load } from '../../../../../shared/html/cheerio'
import type { JavCode } from '../number'
import { absolute, clean, dateOf, minutesOf, str, unique } from '../html'
import type { JavRecord, JavSite, JavSiteId, SiteContext } from '../types'

/** 一个 works 主题站点的配置。 */
export interface WpWorksConfig {
  id: JavSiteId
  /** WordPress 安装地址（站点装在子目录时带上子目录，如 https://faleno.jp/top）。 */
  base: string
  /** 制作商（同站所有厂牌共用）。 */
  studio: string
  /** 发行商缺省值。 */
  label: string
  /** 番号前缀（小写）→ 发行商；站点只在厂牌列表页公布分组，在这里固定。 */
  labelByPrefix?: Readonly<Record<string, string>>
  /** 站点发布的番号前缀：小写、空格分隔；不在其中的番号不查。 */
  prefixes: string
}

/** REST 被拦后多久内直接走 HTML。 */
const REST_BLOCK_MS = 30 * 60 * 1000

type Obj = Record<string, unknown>

/** 番号 → slug：只留字母数字并转小写（FNS-257 → fns257）。 */
export function wpSlug(code: string): string {
  return code.toLowerCase().replace(/[^0-9a-z]/g, '')
}

/** slug 的字母前缀。 */
const prefixOf = (slug: string): string => /^[a-z]+/.exec(slug)?.[0] ?? ''

/** 出演女優：以「/」「、」或空白分隔。 */
export function splitActors(value: string | undefined): string[] {
  return unique((value ?? '').split(/[/、\s]+/).map(name => clean(name)))
}

/** 站点把出演女優拼在作品名末尾：作品名确实以某个出演者结尾时去掉。 */
export function stripActorSuffix(title: string, actors: string[]): string {
  const text = title.trim()
  const hit = actors.find(name => text.endsWith(name))
  return hit ? text.slice(0, -hit.length).trim() : text
}

/** 去掉图片地址上的压缩参数（?output-quality=60），取原图。 */
const original = (url: string | undefined): string | undefined =>
  url?.replace(/\?.*$/, '')

/** 组装结果里各站点共用的部分。 */
function baseRecord(
  config: WpWorksConfig,
  code: string,
  slug: string
): Pick<JavRecord, 'site' | 'code' | 'url' | 'studio' | 'label'> {
  return {
    site: config.id,
    code,
    url: `${config.base}/works/${slug}/`,
    studio: config.studio,
    label: config.labelByPrefix?.[prefixOf(slug)] ?? config.label,
  }
}

/** JSON 文本 → 值；不是合法 JSON 返回 undefined。 */
function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown
  } catch {
    return undefined
  }
}

/**
 * 解析 REST 响应。返回 null 表示站点明确没有这个 slug；
 * 响应不是 JSON 数组（路由不存在、被换成错误页）时返回 undefined，由调用方退到 HTML。
 */
export function parseWpWorksJson(
  config: WpWorksConfig,
  body: string,
  code: string
): JavRecord | null | undefined {
  const data = parseJson(body)
  if (!Array.isArray(data)) return undefined
  const slug = wpSlug(code)
  const post = data.find(
    (p): p is Obj => str(p, 'slug')?.toLowerCase() === slug
  )
  if (!post) return null
  const acf = (post.acf ?? {}) as Obj
  const images = (post.acf_custom_images ?? {}) as Obj
  const actors = splitActors(str(acf, '出演女優'))
  const rawTitle = str(acf, '作品名') ?? str(post.title, 'rendered') ?? ''
  const gallery = Array.isArray(images.gallery_urls) ? images.gallery_urls : []
  return {
    ...baseRecord(config, code, slug),
    title: clean(stripActorSuffix(rawTitle, actors)),
    releaseDate: dateOf(str(acf, '発売日（表示用）')),
    runtimeMinutes: minutesOf(str(acf, '収録時間')),
    tags: [],
    actors: actors.map(name => ({ name })),
    overview: str(acf, '作品紹介文'),
    cover: str(images, 'main_photo_url'),
    poster: str(images, 'sub_photo_url'),
    stills: unique(
      gallery.map(u => (typeof u === 'string' ? clean(u) : undefined))
    ),
  }
}

/**
 * 解析 HTML 详情页。页面 canonical 的 slug 与查询的对不上（被跳到别的作品）或缺失时返回 null。
 * HTML 没有竖版海报与类别。
 */
export function parseWpWorksPage(
  config: WpWorksConfig,
  html: string,
  code: string
): JavRecord | null {
  const $ = load(html)
  const slug = wpSlug(code)
  const canonical =
    $('link[rel="canonical"]').attr('href') ??
    $('meta[property="og:url"]').attr('content')
  const pageSlug = /\/works\/([^/?#]+)/.exec(canonical ?? '')?.[1]
  if (pageSlug?.toLowerCase() !== slug) return null

  /** 「出演女優 / 収録時間 / 発売日」一栏的值。 */
  const field = (label: string): string | undefined =>
    clean(
      $('.box_works01_list li')
        .filter((_, li) => clean($(li).children('span').text()) === label)
        .first()
        .children('p')
        .text()
    )
  const url = `${config.base}/works/${slug}/`
  const actors = splitActors(field('出演女優'))
  return {
    ...baseRecord(config, code, slug),
    title: clean(stripActorSuffix(clean($('h1').first().text()) ?? '', actors)),
    releaseDate: dateOf(field('発売日')) ?? dateOf(field('配信開始日')),
    runtimeMinutes: minutesOf(field('収録時間')),
    tags: [],
    actors: actors.map(name => ({ name })),
    overview: clean($('.box_works01_text').first().text()),
    cover: original(
      absolute(url, $('.box_works01_img img').first().attr('src'))
    ),
    stills: unique(
      $('a.pop_img')
        .map((_, a) => absolute(url, $(a).attr('href')))
        .get()
    ),
  }
}

/** HTTP 403（被拦）。 */
const isForbidden = (error: unknown): boolean =>
  (error as { status?: unknown } | null)?.status === 403

/** 按配置生成一个 works 主题站点。 */
export function createWpWorksSite(
  config: WpWorksConfig,
  now: () => number = Date.now
): JavSite {
  const prefixes = new Set(config.prefixes.split(/\s+/))
  let restBlockedUntil = 0

  /** 走 REST；返回 undefined 表示这条路走不通，需要退到 HTML。 */
  async function viaRest(
    code: string,
    ctx: SiteContext
  ): Promise<JavRecord | null | undefined> {
    if (now() < restBlockedUntil) return undefined
    const api = `${config.base}/wp-json/wp/v2/works?slug=${wpSlug(code)}`
    try {
      const body = await ctx.page(api, {
        headers: { Accept: 'application/json' },
      })
      return body === null ? undefined : parseWpWorksJson(config, body, code)
    } catch (error) {
      if (ctx.signal?.aborted) throw error
      if (!isForbidden(error)) throw error
      restBlockedUntil = now() + REST_BLOCK_MS
      return undefined
    }
  }

  return {
    id: config.id,
    supports: kind => kind === 'censored',
    async fetch(target: JavCode, ctx: SiteContext): Promise<JavRecord | null> {
      const slug = wpSlug(target.code)
      if (!prefixes.has(prefixOf(slug))) return null
      const rest = await viaRest(target.code, ctx)
      if (rest !== undefined) return rest
      const html = await ctx.page(`${config.base}/works/${slug}/`)
      return html ? parseWpWorksPage(config, html, target.code) : null
    },
  }
}
