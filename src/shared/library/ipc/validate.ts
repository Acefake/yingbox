/**
 * IPC 边界上的参数解析：把渲染进程传来的 unknown 解析成契约类型，非法时抛 LibraryError。
 *
 * 只在引擎的 RPC 入口调用一次，内部代码直接信任解析后的类型。
 */
import {
  type AddLibraryRequest,
  type ApplyMatchRequest,
  type FacetFilter,
  type IdentifyRequest,
  LIBRARY_METHODS,
  LIBRARY_SOURCES,
  type LibraryKind,
  type LibraryMethod,
  type LibraryQuery,
  type LibraryQueryFilters,
  type LibraryRpcMap,
  type LibrarySortField,
  type LibrarySource,
  type MatchState,
  type RefreshMetadataRequest,
  type ScanRequest,
  type SetProviderTokenRequest,
  TOKEN_PROVIDERS,
  type TopLevelItemType,
  type WriterSettings,
} from './contract'
import { ACTOR_PARSERS, type NormalizedActorQuery } from './validate-actors'
import {
  asRecord,
  invalid,
  listOf,
  oneOf,
  optionalInt,
  positiveId,
} from './validate-base'
import { FACET_PARSERS, parseFacetFilter } from './validate-facets'
import { parseQueryFilters } from './validate-filters'
import { VISUAL_PARSERS } from './validate-visual'
import { parseJavSettings } from './validate-jav'
import {
  parseAutomationPatch,
  parseNotifyChanges,
  parseUpdateLibrary,
} from './validate-library'
import { validateTemplate } from '../writer/template'

/** 默认每页条数。 */
export const DEFAULT_PAGE_SIZE = 200
/** 每页条数上限。 */
export const MAX_PAGE_SIZE = 1000

/** 归一化后的查询：分页、排序都有确定值。 */
export interface NormalizedLibraryQuery extends LibraryQueryFilters {
  libraryId?: number
  source?: LibrarySource
  types: TopLevelItemType[]
  search?: string
  actorId?: number
  yearFrom?: number
  yearTo?: number
  matchStates?: MatchState[]
  facets?: FacetFilter
  sort: LibrarySortField
  order: 'asc' | 'desc'
  offset: number
  limit: number
}

const SORT_FIELDS: readonly LibrarySortField[] = [
  'title',
  'year',
  'rating',
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
    source:
      q.source === undefined
        ? undefined
        : oneOf(q.source, LIBRARY_SOURCES, 'source'),
    types: listOf(q.types, TOP_LEVEL_TYPES, 'types') ?? [...TOP_LEVEL_TYPES],
    search,
    actorId:
      q.actorId === undefined ? undefined : positiveId(q.actorId, 'actorId'),
    yearFrom: optionalInt(q.yearFrom, 'yearFrom', 0),
    yearTo: optionalInt(q.yearTo, 'yearTo', 0),
    matchStates: listOf(q.matchStates, MATCH_STATES, 'matchStates'),
    facets: parseFacetFilter(q.facets),
    ...parseQueryFilters(q),
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
  const kind = oneOf(r.kind, LIBRARY_KINDS, 'kind')
  const source =
    r.source === undefined ? 'tmdb' : oneOf(r.source, LIBRARY_SOURCES, 'source')
  if (source === 'jav' && kind !== 'movie') invalid('番号库只能是电影库')
  return {
    root: (r.root as string).trim(),
    kind,
    name: (r.name as string | undefined)?.trim() || undefined,
    source,
    automation: parseAutomationPatch(r.automation),
  }
}

function parseScan(input: unknown): ScanRequest {
  const r = asRecord(input, 'scan 参数')
  return { libraryId: positiveId(r.libraryId, 'libraryId'), full: !!r.full }
}

/** 一次识别 / 刷新最多点名的条目数。 */
export const MAX_ITEM_IDS = 10_000

function itemIdList(value: unknown): number[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return invalid('itemIds 必须是数组')
  if (value.length > MAX_ITEM_IDS) {
    return invalid(`itemIds 一次最多 ${MAX_ITEM_IDS} 个`)
  }
  return [...new Set(value.map(v => positiveId(v, 'itemIds')))]
}

/** 识别 / 刷新：libraryId 与 itemIds 至少给一个。 */
function parseTargets(input: unknown, what: string): IdentifyRequest {
  const r = asRecord(input, `${what} 参数`)
  const libraryId =
    r.libraryId === undefined || r.libraryId === null
      ? undefined
      : positiveId(r.libraryId, 'libraryId')
  const itemIds = itemIdList(r.itemIds)
  if (libraryId === undefined && !itemIds?.length) {
    invalid('libraryId 与 itemIds 至少提供一个')
  }
  return { libraryId, itemIds, force: !!r.force }
}

const optionalText = (
  value: unknown,
  name: string,
  max = 200
): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return invalid(`${name} 必须是字符串`)
  const text = value.trim()
  if (!text) return undefined
  if (text.length > max) return invalid(`${name} 过长`)
  return text
}

function parseApplyMatch(input: unknown): ApplyMatchRequest {
  const r = asRecord(input, 'applyMatch 参数')
  const itemId = positiveId(r.itemId, 'itemId')
  const tmdbId = optionalText(r.tmdbId, 'tmdbId', 20)
  const imdbId = optionalText(r.imdbId, 'imdbId', 20)
  const tvdbId = optionalText(r.tvdbId, 'tvdbId', 20)
  if (tmdbId !== undefined && !/^\d+$/.test(tmdbId))
    invalid('tmdbId 必须是数字')
  if (imdbId !== undefined && !/^tt\d{6,9}$/i.test(imdbId)) {
    invalid('imdbId 格式应为 tt 加数字')
  }
  if (tvdbId !== undefined && !/^\d+$/.test(tvdbId))
    invalid('tvdbId 必须是数字')
  let query: ApplyMatchRequest['query']
  if (r.query !== undefined && r.query !== null) {
    const q = asRecord(r.query, 'query')
    const title = optionalText(q.title, 'query.title')
    if (!title) invalid('query.title 不能为空')
    query = { title: title!, year: optionalInt(q.year, 'query.year', 1800) }
  }
  const given = [tmdbId, imdbId, tvdbId, query].filter(v => v !== undefined)
  if (given.length !== 1) {
    invalid('tmdbId / imdbId / tvdbId / query 必须且只能提供一个')
  }
  return {
    itemId,
    tmdbId,
    imdbId: imdbId?.toLowerCase(),
    tvdbId,
    query,
    lock: r.lock === undefined ? true : !!r.lock,
  }
}

function parseSetToken(input: unknown): SetProviderTokenRequest {
  const r = asRecord(input, 'setProviderToken 参数')
  const provider = oneOf(r.provider, TOKEN_PROVIDERS, 'provider')
  if (
    r.token !== null &&
    r.token !== undefined &&
    typeof r.token !== 'string'
  ) {
    invalid('token 必须是字符串或 null')
  }
  const token = typeof r.token === 'string' ? r.token.trim() : ''
  if (token.length > 2000) invalid('token 过长')
  if (/\s/.test(token)) invalid('token 不能包含空白字符')
  return { provider, token: token || null }
}

function bool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') return invalid(`${name} 必须是布尔值`)
  return value
}

function template(value: unknown, name: string, kind: 'movie' | 'tv'): string {
  if (typeof value !== 'string') return invalid(`${name} 必须是字符串`)
  const error = validateTemplate(value, kind)
  if (error) invalid(`${name}：${error}`)
  return value.trim()
}

/** 写出设置：每个字段都必须给全（设置页整份提交），模板按语法校验。 */
export function parseWriterSettings(input: unknown): WriterSettings {
  const r = asRecord(input, 'settings')
  const nfo = asRecord(r.nfo, 'nfo')
  const art = asRecord(r.artwork, 'artwork')
  const org = asRecord(r.organize, 'organize')
  return {
    nfo: {
      enabled: bool(nfo.enabled, 'nfo.enabled'),
      mode: oneOf(nfo.mode, ['merge', 'overwrite'] as const, 'nfo.mode'),
    },
    artwork: {
      poster: bool(art.poster, 'artwork.poster'),
      fanart: bool(art.fanart, 'artwork.fanart'),
      logo: bool(art.logo, 'artwork.logo'),
      seasonArt: bool(art.seasonArt, 'artwork.seasonArt'),
      actors: bool(art.actors, 'artwork.actors'),
      legacyNames: bool(art.legacyNames, 'artwork.legacyNames'),
    },
    autoWriteAfterIdentify: bool(
      r.autoWriteAfterIdentify,
      'autoWriteAfterIdentify'
    ),
    organize: {
      enabled: bool(org.enabled, 'organize.enabled'),
      movieTemplate: template(
        org.movieTemplate,
        'organize.movieTemplate',
        'movie'
      ),
      tvTemplate: template(org.tvTemplate, 'organize.tvTemplate', 'tv'),
    },
  }
}

/** 写出 / 整理点名的条目：非空。 */
function requiredItemIds(input: unknown): { itemIds: number[] } {
  const itemIds = itemIdList(asRecord(input, '参数').itemIds)
  if (!itemIds?.length) invalid('itemIds 不能为空')
  return { itemIds: itemIds! }
}

const itemIdParam = (input: unknown): { itemId: number } => ({
  itemId: positiveId(asRecord(input, '参数').itemId, 'itemId'),
})

/** 解析后的参数类型：query 补全了默认值，其余与契约一致。 */
export type ParsedRpcParams<M extends LibraryMethod> = M extends 'query'
  ? NormalizedLibraryQuery
  : M extends 'actors.list'
    ? NormalizedActorQuery
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
  updateLibrary: parseUpdateLibrary,
  scan: parseScan,
  query: normalizeLibraryQuery,
  getItem: itemIdParam,
  getPreview: itemIdParam,
  identify: input => parseTargets(input, 'identify'),
  getMatchCandidates: itemIdParam,
  applyMatch: parseApplyMatch,
  lockMatch: itemIdParam,
  unlockMatch: itemIdParam,
  refreshMetadata: (input): RefreshMetadataRequest => {
    const { libraryId, itemIds } = parseTargets(input, 'refreshMetadata')
    return { libraryId, itemIds }
  },
  setProviderToken: parseSetToken,
  getProviderStatus: () => undefined,
  notifyChanges: parseNotifyChanges,
  'writer.getSettings': () => undefined,
  'writer.setSettings': parseWriterSettings,
  'writer.write': requiredItemIds,
  'writer.previewOrganize': requiredItemIds,
  'writer.applyOrganize': input => {
    const planId = asRecord(input, '参数').planId
    if (typeof planId !== 'string' || !/^[0-9a-f-]{36}$/.test(planId)) {
      invalid('planId 格式不对')
    }
    return { planId: planId as string }
  },
  'writer.undoOrganize': input => ({
    batchId: positiveId(asRecord(input, '参数').batchId, 'batchId'),
  }),
  'writer.listOrganizeBatches': () => undefined,
  'jav.getSettings': () => undefined,
  'jav.setSettings': parseJavSettings,
  ...ACTOR_PARSERS,
  ...FACET_PARSERS,
  ...VISUAL_PARSERS,
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
