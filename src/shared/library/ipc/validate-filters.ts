/**
 * IPC 边界上海报墙附加筛选（contract-filters.ts）的解析：非法时抛 LibraryError（invalid-params）。
 * 空列表视为不筛选，结果里不出现该字段。
 */
import { type LibraryQueryFilters, MAX_FILTER_IDS } from './contract-filters'
import { asRecord, invalid, positiveId } from './validate-base'

/** 国家 / 人名最多几个。 */
const MAX_NAMES = 20
/** 单个人名最长字符数。 */
const MAX_NAME_LENGTH = 100

/** 字符串列表：去空白、去重；空列表返回 undefined。 */
function names(
  value: unknown,
  name: string,
  map: (text: string) => string = text => text
): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return invalid(`${name} 必须是字符串数组`)
  if (value.length > MAX_NAMES) invalid(`${name} 最多 ${MAX_NAMES} 个`)
  const out = new Set<string>()
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') invalid(`${name} 必须是字符串数组`)
    const text = map((item as string).trim())
    if (text.length > MAX_NAME_LENGTH) invalid(`${name} 的取值太长`)
    if (text) out.add(text)
  }
  return out.size ? [...out] : undefined
}

/** id 列表：正整数、去重，最多 MAX_FILTER_IDS 个；空列表视为未给。 */
function idList(value: unknown, name: string): number[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return invalid(`${name} 必须是数组`)
  if (value.length > MAX_FILTER_IDS)
    invalid(`${name} 最多 ${MAX_FILTER_IDS} 个`)
  const out = [...new Set((value as unknown[]).map(v => positiveId(v, name)))]
  return out.length ? out : undefined
}

/** 评分下限：0–10 的数字。 */
function rating(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !(value >= 0 && value <= 10))
    return invalid('ratingMin 必须是 0–10 的数字')
  return value
}

/**
 * 从查询对象里取出附加筛选（只返回给了的字段）。
 * ids 给了空数组表示「白名单为空」：保留为 []，查询返回 0 条。
 */
export function parseQueryFilters(input: unknown): LibraryQueryFilters {
  const r = asRecord(input, 'query')
  const out: LibraryQueryFilters = {}
  const ratingMin = rating(r.ratingMin)
  if (ratingMin !== undefined) out.ratingMin = ratingMin
  const countries = names(r.countries, 'countries', c => c.toUpperCase())
  if (countries) out.countries = countries
  const people = names(r.people, 'people')
  if (people) out.people = people
  if (Array.isArray(r.ids) && r.ids.length === 0) out.ids = []
  else {
    const ids = idList(r.ids, 'ids')
    if (ids) out.ids = ids
  }
  const excludeIds = idList(r.excludeIds, 'excludeIds')
  if (excludeIds) out.excludeIds = excludeIds
  return out
}
