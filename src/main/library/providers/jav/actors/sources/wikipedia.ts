/**
 * 维基百科（默认日文维基优先）：先用维基数据找人，再取词条正文做简介。
 *
 * 1. wbsearchentities 按 ja → zh → en 逐语言检索，只留描述命中 AV 关键词的候选；
 *    一种语言有候选就先核对，核对不上才换下一种语言（多数演员一次检索就够）。
 * 2. wbgetentities 一次批量取候选实体，要求是 AV 从业者（描述关键词或 P106 职业）且
 *    标签 / 别名与查找名相同——检索是模糊的，只看描述会把别人的档案当成本人。
 * 3. 生日 P569、性别 P21、身高 P2048、肖像 P18、外站 id 取自实体；
 *    简介按 pageLanguages 顺序取第一个有正文的词条（TextExtracts 纯文本，比整页 HTML 小一个数量级）。
 * 日文「女優」= 普通女演员，不单独当 AV 关键词。单语言失败不阻断，全部失败才抛错。
 * 行为参考 Amane 的 wikipedia 演员爬虫，代码独立实现。
 */
import { calendarDate, hasName, normalizeName, uniqueNames } from '../names'
import type {
  ActorContext,
  ActorGender,
  ActorProfile,
  ActorSource,
} from '../types'
import { clipOverview, overviewBlocks } from './wiki-overview'

export const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'

type Obj = Record<string, unknown>
type WikiLang = 'ja' | 'zh' | 'en'

const SEARCH_LANGS: readonly WikiLang[] = ['ja', 'zh', 'en']
const LABEL_LANGS = ['ja', 'zh', 'zh-cn', 'zh-hans', 'zh-tw', 'zh-hant', 'en']
const CANDIDATE_LIMIT = 5

const AV_KEYWORDS = [
  'av idol',
  'av actress',
  'av actor',
  'adult actress',
  'adult actor',
  'adult model',
  'porn actress',
  'porn actor',
  'pornographic',
  'japanese idol',
  'gravure',
  'av女優',
  'av女优',
  'av男優',
  'av男优',
  'avアイドル',
  'av監督',
  'アダルト',
  '成人映画',
  '成人影片',
]
const AV_INDUSTRY = /\b(?:av|adult|porn|xxx)\b/i
const AV_ROLE = /\b(?:actress|actor|idol|model|star)\b/i
/** P106 职业：AV女優、AV男優、色情演员。 */
const AV_OCCUPATIONS = new Set(['Q1079215', 'Q8380347', 'Q488111'])
const P21_GENDER: Record<string, ActorGender> = {
  Q6581072: 'female',
  Q6581097: 'male',
}
/** 外站 id 属性。 */
const ID_PROPS: Record<string, string> = {
  P345: 'imdb',
  P4985: 'tmdb',
  P2002: 'twitter',
  P2003: 'instagram',
  P9781: 'fanza',
}
const UNIT_CM = 'Q174728'
const UNIT_M = 'Q11573'

const obj = (value: unknown): Obj | undefined =>
  value && typeof value === 'object' ? (value as Obj) : undefined
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

/** 描述是否像 AV 从业者。 */
export function isAvDescription(description: string): boolean {
  const lower = description.toLowerCase()
  if (AV_KEYWORDS.some(k => lower.includes(k))) return true
  return AV_INDUSTRY.test(description) && AV_ROLE.test(description)
}

/** wbsearchentities 结果 → [QID, 描述]，只留描述命中 AV 关键词的。 */
export function wikidataCandidates(data: unknown): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const items = obj(data)?.search
  for (const item of Array.isArray(items) ? items : []) {
    const id = text(obj(item)?.id)
    const desc = text(obj(item)?.description) ?? ''
    if (id?.startsWith('Q') && isAvDescription(desc)) out.push([id, desc])
  }
  return out
}

/** 某属性第一条声明的取值。 */
function claimValue(entity: Obj, prop: string): unknown {
  const claims = obj(entity.claims)?.[prop]
  const first = Array.isArray(claims) ? obj(claims[0]) : undefined
  return obj(obj(first?.mainsnak)?.datavalue)?.value
}

/** 实体在某字段（labels / descriptions）各语言的值，按 langs 顺序。 */
function langValues(entity: Obj, key: string, langs: string[]): string[] {
  const group = obj(entity[key])
  return langs
    .map(l => text(obj(group?.[l])?.value))
    .filter((v): v is string => Boolean(v))
}

/** 实体的全部名字：labels + aliases（所有语言）。 */
function entityNames(entity: Obj): string[] {
  const out: string[] = []
  for (const key of ['labels', 'aliases']) {
    for (const value of Object.values(obj(entity[key]) ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) {
        const v = text(obj(item)?.value)
        if (v) out.push(v)
      }
    }
  }
  return out
}

/** 是 AV 从业者且名字对得上。 */
export function matchesActor(entity: Obj, name: string): boolean {
  const descs = Object.values(obj(entity.descriptions) ?? {})
    .map(d => text(obj(d)?.value))
    .filter((d): d is string => Boolean(d))
  const occupations = obj(entity.claims)?.P106
  const isAv =
    descs.some(isAvDescription) ||
    (Array.isArray(occupations) &&
      occupations.some(c => {
        const value = obj(obj(obj(obj(c)?.mainsnak)?.datavalue)?.value)
        return AV_OCCUPATIONS.has(String(value?.id))
      }))
  return isAv && hasName(entityNames(entity), name)
}

/** 身高（cm）：P2048，单位厘米或米。 */
function heightOf(entity: Obj): number | undefined {
  const value = obj(claimValue(entity, 'P2048'))
  const amount = Number(text(value?.amount))
  if (!(amount > 0)) return undefined
  const unit = text(value?.unit) ?? ''
  if (unit.endsWith(`/${UNIT_M}`)) return Math.round(amount * 100)
  return unit.endsWith(`/${UNIT_CM}`) ? Math.round(amount) : undefined
}

/** 实体 → 演员资料（还没有简介与词条地址）。 */
export function wikidataProfile(
  qid: string,
  entity: Obj,
  tagline?: string
): ActorProfile {
  const labels = langValues(entity, 'labels', LABEL_LANGS)
  const name = normalizeName(labels[0] ?? qid)
  const ids: Record<string, string> = { wikidata: qid }
  for (const [prop, key] of Object.entries(ID_PROPS)) {
    const v = text(claimValue(entity, prop))
    if (v) ids[key] = v
  }
  const image = text(claimValue(entity, 'P18'))
  return {
    source: 'wikipedia',
    name,
    aliases: uniqueNames(labels, name),
    gender: P21_GENDER[String(obj(claimValue(entity, 'P21'))?.id)],
    birthday: calendarDate(text(obj(claimValue(entity, 'P569'))?.time)),
    height: heightOf(entity),
    tagline:
      tagline ||
      langValues(entity, 'descriptions', [
        'zh',
        'zh-cn',
        'zh-hans',
        'ja',
        'en',
      ])[0],
    images: image
      ? [
          `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image)}`,
        ]
      : [],
    ids,
    url: `https://www.wikidata.org/wiki/${qid}`,
  }
}

/** 词条标题（来自实体 sitelinks）。 */
function wikiTitle(entity: Obj, lang: WikiLang): string | undefined {
  return text(obj(obj(entity.sitelinks)?.[`${lang}wiki`])?.title)
}

/** TextExtracts 接口地址；中文维基转简体。 */
export function extractUrl(lang: WikiLang, title: string): string {
  const variant = lang === 'zh' ? '&variant=zh-cn' : ''
  return `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&format=json&formatversion=2${variant}&titles=${encodeURIComponent(title)}`
}

/** TextExtracts 结果 → 正文纯文本。 */
export function extractText(data: unknown): string | undefined {
  const pages = obj(obj(data)?.query)?.pages
  return Array.isArray(pages) ? text(obj(pages[0])?.extract) : undefined
}

/** 词条页面地址。 */
function wikiPageUrl(lang: WikiLang, title: string): string {
  const path = lang === 'zh' ? 'zh-cn' : 'wiki'
  return `https://${lang}.wikipedia.org/${path}/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

export interface WikipediaOptions {
  /** 取正文的语言顺序，默认日文 → 中文 → 英文。 */
  pageLanguages?: readonly WikiLang[]
}

/** 按顺序试每个任务；有结果即返回，全失败才抛最后一个错。 */
async function firstOf<T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R | undefined>
): Promise<R | undefined> {
  let lastError: unknown
  let failed = 0
  for (const item of items) {
    try {
      const result = await run(item)
      if (result !== undefined) return result
    } catch (error) {
      lastError = error
      failed++
    }
  }
  if (failed && failed === items.length) throw lastError
  return undefined
}

export function createWikipediaSource(
  options: WikipediaOptions = {}
): ActorSource {
  const pageLangs = options.pageLanguages ?? SEARCH_LANGS
  const json = async (ctx: ActorContext, url: string): Promise<unknown> => {
    const body = await ctx.page(url, {
      headers: { Accept: 'application/json' },
    })
    return body === null ? null : JSON.parse(body)
  }

  /** 一种语言检索 + 批量核对；核对上返回 [QID, 实体, 描述]。 */
  async function find(
    ctx: ActorContext,
    name: string,
    lang: WikiLang,
    seen: Set<string>
  ): Promise<[string, Obj, string] | undefined> {
    const search = await json(
      ctx,
      `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&uselang=${lang}&type=item&limit=${CANDIDATE_LIMIT}&format=json`
    )
    const candidates = wikidataCandidates(search).filter(
      ([id]) => !seen.has(id)
    )
    if (!candidates.length) return undefined
    candidates.forEach(([id]) => seen.add(id))
    const data = await json(
      ctx,
      `${WIKIDATA_API}?action=wbgetentities&ids=${candidates.map(([id]) => id).join('%7C')}&props=labels%7Caliases%7Cdescriptions%7Cclaims%7Csitelinks&sitefilter=jawiki%7Czhwiki%7Cenwiki&format=json`
    )
    const entities = obj(obj(data)?.entities)
    for (const [id, desc] of candidates) {
      const entity = obj(entities?.[id])
      if (entity && matchesActor(entity, name)) return [id, entity, desc]
    }
    return undefined
  }

  return {
    id: 'wikipedia',
    label: '维基百科',
    capability: 'profile',
    genders: ['female', 'male'],
    async fetch(name: string, ctx: ActorContext): Promise<ActorProfile | null> {
      const target = name.trim()
      if (!target) return null
      const seen = new Set<string>()
      const hit = await firstOf(SEARCH_LANGS, lang =>
        find(ctx, target, lang, seen)
      )
      if (!hit) return null
      const [qid, entity, desc] = hit
      const profile = wikidataProfile(qid, entity, desc)
      const langs = pageLangs.filter(l => wikiTitle(entity, l))
      const page = await firstOf(langs, async lang => {
        const title = wikiTitle(entity, lang)!
        const body = extractText(await json(ctx, extractUrl(lang, title)))
        const overview = body && clipOverview(overviewBlocks(body))
        return overview
          ? { overview, url: wikiPageUrl(lang, title) }
          : undefined
      }).catch(() => undefined)
      return page ? { ...profile, ...page } : profile
    },
  }
}
