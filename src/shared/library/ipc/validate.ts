/**
 * IPC 边界上的参数解析：把渲染进程传来的 unknown 解析成契约类型，非法时抛 LibraryError。
 *
 * 只在引擎的 RPC 入口调用一次，内部代码直接信任解析后的类型。
 */
import {
  type AddLibraryRequest,
  LIBRARY_METHODS,
  type LibraryKind,
  type LibraryMethod,
  type LibraryQuery,
  type LibraryRpcMap,
  type LibrarySortField,
  type MatchState,
  type ScanRequest,
  type TopLevelItemType,
} from './contract'
import { LibraryError } from './wire'

/** 默认每页条数。 */
export const DEFAULT_PAGE_SIZE = 200
/** 每页条数上限。 */
export const MAX_PAGE_SIZE = 1000

/** 归一化后的查询：分页、排序都有确定值。 */
export interface NormalizedLibraryQuery {
  libraryId?: number
  types: TopLevelItemType[]
  search?: string
  yearFrom?: number
  yearTo?: number
  matchStates?: MatchState[]
  sort: LibrarySortField
  order: 'asc' | 'desc'
  offset: number
  limit: number
}

const SORT_FIELDS: readonly LibrarySortField[] = [
  'title',
  'year',
  'addedAt',
  'updatedAt',
]
const TOP_LEVEL_TYPES: readonly TopLevelItemType[] = ['movie', 'series']
const MATCH_STATES: readonly MatchState[] = [
  'auto',
  'review',
  'unmatched',
  'locked',
]
const LIBRARY_KINDS: readonly LibraryKind[] = ['movie', 'tv']

const invalid = (message: string): never => {
  throw new LibraryError('invalid-params', message)
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    return invalid(`${what} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function positiveId(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return invalid(`${name} 必须是正整数`)
  }
  return value as number
}

function optionalInt(
  value: unknown,
  name: string,
  min: number
): number | undefined {
  if (value === undefined || value === null) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < min) {
    return invalid(`${name} 必须是不小于 ${min} 的整数`)
  }
  return value as number
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string
): T {
  if (!allowed.includes(value as T)) {
    return invalid(`${name} 只能是 ${allowed.join(' / ')}`)
  }
  return value as T
}

function listOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string
): T[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return invalid(`${name} 必须是数组`)
  const unique = [...new Set(value.map(v => oneOf(v, allowed, name)))]
  return unique.length ? unique : undefined
}

/** 解析并补全列表查询：默认按片名升序、每页 200 条。 */
export function normalizeLibraryQuery(input: unknown): NormalizedLibraryQuery {
  const q = asRecord(input, 'query') as LibraryQuery
  const sort =
    q.sort === undefined ? 'title' : oneOf(q.sort, SORT_FIELDS, 'sort')
  const order =
    q.order === undefined
      ? sort === 'title'
        ? 'asc'
        : 'desc'
      : oneOf(q.order, ['asc', 'desc'] as const, 'order')
  const search =
    typeof q.search === 'string' && q.search.trim()
      ? q.search.trim().slice(0, 200)
      : undefined
  if (q.search !== undefined && typeof q.search !== 'string') {
    invalid('search 必须是字符串')
  }
  return {
    libraryId:
      q.libraryId === undefined
        ? undefined
        : positiveId(q.libraryId, 'libraryId'),
    types: listOf(q.types, TOP_LEVEL_TYPES, 'types') ?? [...TOP_LEVEL_TYPES],
    search,
    yearFrom: optionalInt(q.yearFrom, 'yearFrom', 0),
    yearTo: optionalInt(q.yearTo, 'yearTo', 0),
    matchStates: listOf(q.matchStates, MATCH_STATES, 'matchStates'),
    sort,
    order,
    offset: optionalInt(q.offset, 'offset', 0) ?? 0,
    limit: Math.min(
      optionalInt(q.limit, 'limit', 1) ?? DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE
    ),
  }
}

function parseAddLibrary(input: unknown): AddLibraryRequest {
  const r = asRecord(input, 'addLibrary 参数')
  if (typeof r.root !== 'string' || !r.root.trim()) {
    invalid('root 必须是非空路径')
  }
  if (r.name !== undefined && typeof r.name !== 'string') {
    invalid('name 必须是字符串')
  }
  return {
    root: (r.root as string).trim(),
    kind: oneOf(r.kind, LIBRARY_KINDS, 'kind'),
    name: (r.name as string | undefined)?.trim() || undefined,
  }
}

function parseScan(input: unknown): ScanRequest {
  const r = asRecord(input, 'scan 参数')
  return { libraryId: positiveId(r.libraryId, 'libraryId'), full: !!r.full }
}

/** 解析后的参数类型：query 补全了默认值，其余与契约一致。 */
export type ParsedRpcParams<M extends LibraryMethod> = M extends 'query'
  ? NormalizedLibraryQuery
  : LibraryRpcMap[M]['params']

/** 每个方法的参数解析器。 */
const PARAM_PARSERS: {
  [M in LibraryMethod]: (input: unknown) => ParsedRpcParams<M>
} = {
  listLibraries: () => undefined,
  addLibrary: parseAddLibrary,
  removeLibrary: input => ({
    libraryId: positiveId(asRecord(input, '参数').libraryId, 'libraryId'),
  }),
  scan: parseScan,
  query: normalizeLibraryQuery,
  getItem: input => ({
    itemId: positiveId(asRecord(input, '参数').itemId, 'itemId'),
  }),
}

/** 方法名是否在白名单内。 */
export function isLibraryMethod(value: unknown): value is LibraryMethod {
  return (LIBRARY_METHODS as readonly unknown[]).includes(value)
}

/** 解析某个方法的参数。 */
export function parseRpcParams<M extends LibraryMethod>(
  method: M,
  input: unknown
): ParsedRpcParams<M> {
  return PARAM_PARSERS[method](input)
}
