/**
 * IPC 边界上分面筛选参数的解析：海报墙查询里的 facets 与 facets.list 请求。
 * 非法时抛 LibraryError（invalid-params）。
 */
import {
  FACET_FIELDS,
  type FacetFilter,
  type FacetListRequest,
  type FacetRpcMap,
} from './contract-facets'
import { JAV_KINDS, LIBRARY_SOURCES } from './contract-jav'
import {
  asRecord,
  invalid,
  listOf,
  oneOf,
  optionalInt,
  positiveId,
} from './validate-base'

/** 一个分面最多选几个值。 */
const MAX_VALUES = 50
/** 单个取值最长字符数。 */
const MAX_VALUE_LENGTH = 200
/** facets.list 默认 / 最多返回条数。 */
const DEFAULT_LIMIT = 60
const MAX_LIMIT = 500

/** 文本分面（kind 之外）。 */
const TEXT_FIELDS = ['tag', 'actor', 'studio', 'series', 'director'] as const

/** 字符串列表：去空白、去重；空列表视为不筛选。 */
function values(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) invalid(`${name} 必须是字符串数组`)
  const list = value as unknown[]
  if (list.length > MAX_VALUES) invalid(`${name} 最多 ${MAX_VALUES} 个`)
  const out = new Set<string>()
  for (const item of list) {
    if (typeof item !== 'string') invalid(`${name} 必须是字符串数组`)
    const text = (item as string).trim()
    if (text.length > MAX_VALUE_LENGTH) invalid(`${name} 的取值太长`)
    if (text) out.add(text)
  }
  return out.size ? [...out] : undefined
}

/** 解析海报墙查询里的 facets；什么都没选返回 undefined。 */
export function parseFacetFilter(input: unknown): FacetFilter | undefined {
  if (input === undefined) return undefined
  const r = asRecord(input, 'facets')
  const filter: FacetFilter = {}
  const kind = listOf(r.kind, JAV_KINDS, 'facets.kind')
  if (kind?.length) filter.kind = kind
  for (const field of TEXT_FIELDS) {
    const list = values(r[field], `facets.${field}`)
    if (list) filter[field] = list
  }
  return Object.keys(filter).length ? filter : undefined
}

/** 解析 facets.list 请求，补上默认条数。 */
export function parseFacetListRequest(input: unknown): FacetListRequest {
  const r = asRecord(input, '参数')
  if (r.search !== undefined && typeof r.search !== 'string') {
    invalid('search 必须是字符串')
  }
  const search =
    typeof r.search === 'string' ? r.search.trim().slice(0, 100) : ''
  return {
    field: oneOf(r.field, FACET_FIELDS, 'field'),
    ...(r.source === undefined
      ? {}
      : { source: oneOf(r.source, LIBRARY_SOURCES, 'source') }),
    ...(r.libraryId === undefined
      ? {}
      : { libraryId: positiveId(r.libraryId, 'libraryId') }),
    ...(search ? { search } : {}),
    limit: Math.min(
      optionalInt(r.limit, 'limit', 1) ?? DEFAULT_LIMIT,
      MAX_LIMIT
    ),
  }
}

/** 分面方法的参数解析器（并入 PARAM_PARSERS）。 */
export const FACET_PARSERS: {
  [M in keyof FacetRpcMap]: (input: unknown) => FacetRpcMap[M]['params']
} = {
  'facets.list': parseFacetListRequest,
}
