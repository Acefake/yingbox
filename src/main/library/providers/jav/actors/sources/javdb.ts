/**
 * JavDB 演员页（javdb.com/actors/<id>）：中文别名是它相对其它来源的独特字段，另有头像与性别。
 *
 * 检索 /search?q=<名>&f=actor&locale=zh；偶尔精确命中直接落到演员页，就地解析。
 * 否则在 div.actor-box 里找规范名或 title 别名与查找名相同的一条（不回退首条，避免子串误伤），再取演员页。
 * 演员页：span.actor-section-name 是「名, 别名…」；span.section-meta 里混着别名、性别（只给男优标）、
 * 影片数；头像在 .actor-avatar .avatar 的 background-image，actor_unknow 是占位图。
 * 站点在 Cloudflare 之后，海外 IP 常被挑战；大陆需代理。
 * 行为参考 Amane 的 javdb 演员爬虫，代码独立实现。
 */
import { load } from '../../../../../../shared/html/cheerio'
import { absolute, clean } from '../../html'
import type { PageOptions } from '../../types'
import { hasName, normalizeName, uniqueNames } from '../names'
import type {
  ActorContext,
  ActorGender,
  ActorProfile,
  ActorSource,
} from '../types'

export const JAVDB_BASE = 'https://javdb.com'

const OPTIONS: PageOptions = {
  cookie: 'over18=1; locale=zh',
  headers: { 'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8' },
}

const GENDER_TOKENS: Record<string, ActorGender> = {
  男優: 'male',
  男优: 'male',
  Male: 'male',
  女優: 'female',
  女优: 'female',
  Female: 'female',
}
/** 影片数标注（随语言变化），不是别名。 */
const FILM_COUNT = /\d+\s*(?:部影片|movie\(s\))/i
/** 演员页路径；censored / uncensored / western 是演员列表页。 */
const ACTOR_PATH = /^\/actors\/([A-Za-z0-9]+)\/?$/
const INDEX_SLUGS = new Set(['censored', 'uncensored', 'western'])

/** 「名, 别名，别名」→ 名字列表。 */
function splitNames(raw: string | undefined): string[] {
  return (raw ?? '').split(/[,，]/).map(normalizeName).filter(Boolean)
}

/** 演员页地址 → 站内 id；不是演员页返回 undefined。 */
export function javdbActorId(href: string | undefined): string | undefined {
  if (!href) return undefined
  let path = href
  try {
    path = new URL(href, JAVDB_BASE).pathname
  } catch {
    return undefined
  }
  const slug = ACTOR_PATH.exec(path)?.[1]
  return slug && !INDEX_SLUGS.has(slug.toLowerCase()) ? slug : undefined
}

/** 检索结果里挑名字（含 title 别名）与查找名相同的演员页地址。 */
export function pickJavdbActor(html: string, name: string): string | undefined {
  const $ = load(html)
  for (const a of $('div.actor-box a[href]').toArray()) {
    const href = $(a).attr('href')
    if (!javdbActorId(href)) continue
    const names = [
      normalizeName($(a).find('strong').first().text()),
      ...splitNames($(a).attr('title')),
    ]
    if (hasName(names, name)) return absolute(`${JAVDB_BASE}/`, href)
  }
  return undefined
}

/** 演员页 → 演员资料；不是演员页返回 null。 */
export function parseJavdbActor(
  html: string,
  pageUrl: string
): ActorProfile | null {
  const $ = load(html)
  const names = splitNames($('span.actor-section-name').first().text())
  if (!names.length) return null
  const [name, ...rest] = names

  const aliases = [...rest]
  let gender: ActorGender | undefined
  $('span.section-meta').each((_, el) => {
    for (const token of splitNames($(el).text())) {
      if (GENDER_TOKENS[token]) gender = GENDER_TOKENS[token]
      else if (!FILM_COUNT.test(token)) aliases.push(token)
    }
  })

  const style = $('.actor-avatar .avatar').first().attr('style') ?? ''
  const avatar = /url\(\s*['"]?([^)'"]+)['"]?\s*\)/i.exec(style)?.[1]
  const image =
    avatar && !/actor_unknow/i.test(avatar)
      ? absolute(`${JAVDB_BASE}/`, avatar)
      : undefined
  const url = clean($('link[rel="canonical"]').attr('href')) ?? pageUrl
  const id = javdbActorId(url) ?? javdbActorId(pageUrl)
  return {
    source: 'javdb',
    name,
    aliases: uniqueNames(aliases, name),
    // 演员页只给男优标性别，没标的默认女优
    gender: gender ?? 'female',
    images: image ? [image] : [],
    ids: id ? { javdb: id } : {},
    url,
  }
}

export function javdbSearchUrl(name: string): string {
  return `${JAVDB_BASE}/search?q=${encodeURIComponent(name)}&f=actor&locale=zh`
}

export const javdbActors: ActorSource = {
  id: 'javdb',
  label: 'JavDB',
  capability: 'profile',
  genders: ['female', 'male'],
  async fetch(name: string, ctx: ActorContext): Promise<ActorProfile | null> {
    if (!name.trim()) return null
    const searchUrl = javdbSearchUrl(name.trim())
    const html = await ctx.page(searchUrl, OPTIONS)
    if (html === null) return null
    const direct = parseJavdbActor(html, searchUrl)
    if (direct) return direct
    const url = pickJavdbActor(html, name)
    if (!url) return null
    const page = await ctx.page(url, OPTIONS)
    return page === null ? null : parseJavdbActor(page, url)
  },
}
