/**
 * 自然语言搜索的结构化条件：类型定义、交给模型的 JSON Schema 与系统提示、模型输出的清洗。
 *
 * 模型只做「一句话 → 条件 JSON」，查询仍在本地引擎完成（映射见 nl-rules.ts）。
 * 模型输出一律当不可信数据：sanitizeNlFilter 只留认识的字段、夹紧范围、去重。纯函数，便于测试。
 */
import type { WallSort } from '../state/query-state'

/** 解析出的排序。 */
export interface NlSort {
  field: WallSort
  order: 'asc' | 'desc'
}

/** 一句话解析出的筛选条件；字段缺省表示不限。 */
export interface NlFilter {
  /** 电影 / 剧集 */
  type?: 'movie' | 'series'
  /** 类型（科幻、喜剧……），同时满足 */
  genres?: string[]
  yearFrom?: number
  yearTo?: number
  /** 评分下限（含），0–10 */
  ratingMin?: number
  /** 人名（导演、演员……），每个人都要参与 */
  people?: string[]
  /** 制片国家 / 地区（ISO 3166-1 两位代码），任一即可 */
  countries?: string[]
  /** true = 看过 / 在看，false = 没看过 */
  watched?: boolean
  sort?: NlSort
  /** 片名关键词（最多一个，交给引擎的片名搜索） */
  keywords?: string[]
}

/** 排序字段（与海报墙一致）。 */
const SORT_FIELDS: readonly WallSort[] = ['addedAt', 'title', 'year', 'rating']

const nullable = (type: string): { type: string[] } => ({
  type: [type, 'null'],
})
const stringList = { type: 'array', items: { type: 'string' } }

/**
 * 交给 chatJson 的 JSON Schema。支持 json_schema 的服务商按 strict 模式约束，
 * 所以每个字段都 required，「不限」用 null / 空数组表示。
 */
export const NL_FILTER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'type',
    'genres',
    'yearFrom',
    'yearTo',
    'ratingMin',
    'people',
    'countries',
    'watched',
    'sort',
    'order',
    'keywords',
  ],
  properties: {
    type: { type: ['string', 'null'], enum: ['movie', 'series', null] },
    genres: stringList,
    yearFrom: nullable('integer'),
    yearTo: nullable('integer'),
    ratingMin: nullable('number'),
    people: stringList,
    countries: stringList,
    watched: nullable('boolean'),
    sort: { type: ['string', 'null'], enum: [...SORT_FIELDS, null] },
    order: { type: ['string', 'null'], enum: ['asc', 'desc', null] },
    keywords: stringList,
  },
}

/**
 * 系统提示：说明字段含义与常见说法的换算。
 * @param genres 本分区实际有的类型取值（让模型从里面挑，避免译名对不上）
 * @param year 今年（换算「近五年」「去年」）
 */
export function nlSystemPrompt(
  genres: readonly string[],
  year: number
): string {
  const vocabulary = genres.length
    ? `genres 只能从这些取值里选（原样输出）：${genres.join('、')}。`
    : 'genres 用常见中文类型名（科幻、喜剧、动作、爱情、恐怖、悬疑、犯罪、动画、纪录、剧情、战争、奇幻、惊悚）。'
  return [
    '你把用户在本地片库里的搜索语句转成筛选条件 JSON，只输出 JSON。',
    `今年是 ${year} 年。没提到的条件一律用 null 或空数组，不要猜。`,
    'type：电影 movie，剧集 / 电视剧 / 某国剧 series。',
    vocabulary,
    '年代：「90 年代」= 1990–1999，「2010 年以后」yearFrom 2010，「近五年」yearFrom 今年减 4。',
    'ratingMin：只在说了具体分数时填（「8 分以上」= 8）；「评分高的」「高分」只填 sort = rating、order = desc。',
    'people：导演或演员的名字，用用户的说法（如「诺兰」），一人一项。',
    'countries：ISO 3166-1 两位代码，韩剧 KR、日本 JP、美剧 US、英剧 GB、港片 HK、台湾 TW、国产 / 大陆 CN。',
    'watched：「没看过」false，「看过」「在看」true。',
    'sort：rating 评分、year 年份、addedAt 添加时间、title 片名；「最新」year desc，「最近添加」addedAt desc。',
    'keywords：只放片名里的字词，最多一个；能归到其他字段的词不要放这里。',
  ].join('\n')
}

const MIN_YEAR = 1870
const MAX_YEAR = 2100
const MAX_ITEMS = 8

/** 字符串数组：去空白、去重、限长度与个数。 */
function strings(value: unknown, max = MAX_ITEMS): string[] {
  if (!Array.isArray(value)) return []
  const out = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.trim().slice(0, 50)
    if (text) out.add(text)
  }
  return [...out].slice(0, max)
}

/** 年份：整数且在合理范围内，否则 undefined。 */
function year(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const y = Math.round(value)
  return y >= MIN_YEAR && y <= MAX_YEAR ? y : undefined
}

/**
 * 模型输出 → NlFilter：只留认识的字段，非法值丢弃，年份反了就对调，空条件不出现。
 * 输入不是对象时返回 {}。
 */
export function sanitizeNlFilter(raw: unknown): NlFilter {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const out: NlFilter = {}
  if (r.type === 'movie' || r.type === 'series') out.type = r.type
  const genres = strings(r.genres)
  if (genres.length) out.genres = genres
  let from = year(r.yearFrom)
  let to = year(r.yearTo)
  if (from !== undefined && to !== undefined && from > to)
    [from, to] = [to, from]
  if (from !== undefined) out.yearFrom = from
  if (to !== undefined) out.yearTo = to
  if (typeof r.ratingMin === 'number' && Number.isFinite(r.ratingMin)) {
    const rating = Math.min(10, Math.max(0, r.ratingMin))
    if (rating > 0) out.ratingMin = Math.round(rating * 10) / 10
  }
  const people = strings(r.people)
  if (people.length) out.people = people
  const countries = strings(r.countries)
    .map(c => c.toUpperCase())
    .filter(c => /^[A-Z]{2}$/.test(c))
  if (countries.length) out.countries = [...new Set(countries)]
  if (typeof r.watched === 'boolean') out.watched = r.watched
  const field = SORT_FIELDS.find(f => f === r.sort)
  if (field) {
    const order =
      r.order === 'asc' || r.order === 'desc'
        ? r.order
        : field === 'title'
          ? 'asc'
          : 'desc'
    out.sort = { field, order }
  }
  const keywords = strings(r.keywords, 1)
  if (keywords.length) out.keywords = keywords
  return out
}

/** 条件是否为空（什么都没解析出来）。 */
export const isEmptyFilter = (filter: NlFilter): boolean =>
  Object.keys(filter).length === 0
