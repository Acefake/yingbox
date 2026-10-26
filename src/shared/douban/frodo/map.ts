/**
 * frodo 响应 → rexxar 同形结构。
 *
 * 两边接口同源，实测（2026-10）结构一致；这里仍逐字段收一遍，只留调用方读的字段，
 * 这样 frodo 哪天多出 / 少掉字段也不会把奇怪的值带进解析层。映射是幂等的：rexxar 的响应
 * 再过一遍得到同样的结构（缓存里不区分来源，读出来统一过一遍即可）。
 *
 * - 搜索（/search/movie）→ `{ items: [{ target_type, target: { id, title, year, card_subtitle } }] }`，
 *   供 main/library/providers/douban/douban-genres.ts 的 pickDoubanGenres 解析；
 * - 列表（/<movie|tv>/recommend、/subject/recent_hot/<kind>）→ `{ items, total }`，
 *   供 engine/online/douban-browse.ts 的 parseRecommend 解析（广告、片单卡原样带 type，由它过滤）；
 * - 条目详情（/movie/<id>、/tv/<id>）→ {@link DoubanSubjectDetail}。
 */

type Json = Record<string, unknown>

const asObject = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(text).filter(Boolean) : []

/** 只留评分里调用方用到的两个数。 */
function ratingOf(value: unknown): { value: number; count: number } | null {
  const r = asObject(value)
  if (!r) return null
  const score = Number(r.value)
  const count = Number(r.count)
  return {
    value: Number.isFinite(score) ? score : 0,
    count: Number.isFinite(count) ? count : 0,
  }
}

/** rexxar 搜索结果里的一条。 */
export interface DoubanSearchItem {
  target_type: string
  target: { id: string; title: string; year: string; card_subtitle: string }
}

/** rexxar 搜索结果。 */
export interface DoubanSearchBody {
  items: DoubanSearchItem[]
}

/**
 * 搜索响应 → rexxar 搜索结构；不是 `{items: []}` 返回 null（与 404 一样当作没有结果）。
 * 只留影视条目（target_type movie / tv），人物、豆列等卡片丢掉。
 */
export function mapSearch(body: unknown): DoubanSearchBody | null {
  const raw = asObject(body)?.items
  if (!Array.isArray(raw)) return null
  const items: DoubanSearchItem[] = []
  for (const entry of raw) {
    const item = asObject(entry)
    const target = asObject(item?.target)
    const type = text(item?.target_type)
    if (!target || (type !== 'movie' && type !== 'tv')) continue
    const title = text(target.title)
    if (!title) continue
    items.push({
      target_type: type,
      target: {
        id: text(target.id) || text(item?.target_id),
        title,
        year: text(target.year),
        card_subtitle: text(target.card_subtitle),
      },
    })
  }
  return { items }
}

/** 搜索结果是不是空的（null 也算）。 */
export const isEmptySearch = (body: unknown): boolean =>
  !mapSearch(body)?.items.length

/** rexxar 列表里的一条（影视条目，或原样保留 type 的其他卡片）。 */
export interface DoubanListItem {
  id: string
  /** movie / tv / 其他卡片类型；接口没给时不带（解析层把没有 type 的当影视条目） */
  type?: string
  title: string
  year: string
  card_subtitle: string
  cover_url: string
  pic: { normal: string; large: string } | null
  rating: { value: number; count: number } | null
}

/** rexxar 列表（recommend / recent_hot）。 */
export interface DoubanListBody {
  items: DoubanListItem[]
  /** 接口给的总数；没给为 undefined（解析层据此按「还有下一页」处理） */
  total?: number
}

/** 列表响应 → rexxar 列表结构；不是 `{items: []}` 返回 null。 */
export function mapList(body: unknown): DoubanListBody | null {
  const obj = asObject(body)
  if (!obj || !Array.isArray(obj.items)) return null
  const items: DoubanListItem[] = []
  for (const entry of obj.items) {
    const s = asObject(entry)
    if (!s) continue
    const pic = asObject(s.pic)
    const type = text(s.type)
    items.push({
      id: text(s.id),
      ...(type ? { type } : {}),
      title: text(s.title),
      year: text(s.year),
      card_subtitle: text(s.card_subtitle),
      cover_url: text(s.cover_url),
      pic: pic ? { normal: text(pic.normal), large: text(pic.large) } : null,
      rating: ratingOf(s.rating),
    })
  }
  const total = Number(obj.total)
  return Number.isFinite(total) && obj.total !== null
    ? { items, total }
    : { items }
}

/** 条目详情（只留补类型 / 展示会用到的字段）。 */
export interface DoubanSubjectDetail {
  id: string
  kind: 'movie' | 'tv'
  title: string
  originalTitle: string
  year: string
  /** 类型（剧情、喜剧…） */
  genres: string[]
  /** 地区（中文名，如「中国大陆」） */
  countries: string[]
  /** 与搜索卡片同格式的副标题 */
  cardSubtitle: string
  rating: { value: number; count: number } | null
  cover: string
}

/** 详情响应 → {@link DoubanSubjectDetail}；没有 id / 片名返回 null。 */
export function mapSubject(body: unknown): DoubanSubjectDetail | null {
  const s = asObject(body)
  const id = text(s?.id)
  const title = text(s?.title)
  if (!s || !id || !title) return null
  const pic = asObject(s.pic)
  return {
    id,
    kind: s.type === 'tv' || s.is_tv === true ? 'tv' : 'movie',
    title,
    originalTitle: text(s.original_title),
    year: text(s.year),
    genres: strings(s.genres),
    countries: strings(s.countries),
    cardSubtitle: text(s.card_subtitle),
    rating: ratingOf(s.rating),
    cover: text(pic?.large) || text(pic?.normal),
  }
}
