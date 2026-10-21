/**
 * IPC 边界上演员库参数的解析：列表查询、编辑、刷新、来源设置。非法时抛 LibraryError（invalid-params）。
 */
import {
  ACTOR_FIELDS,
  ACTOR_SOURCES,
  type ActorField,
  type ActorGender,
  type ActorListQuery,
  type ActorMethod,
  type ActorProfileValues,
  type ActorRpcMap,
  type ActorSettings,
  type ActorSortField,
  type ActorSourceId,
  type RefreshActorsRequest,
  type UpdateActorRequest,
} from './contract-actors'
import {
  asRecord,
  invalid,
  listOf,
  oneOf,
  optionalInt,
  positiveId,
} from './validate-base'

/** 演员列表默认每页条数。 */
export const ACTOR_PAGE_SIZE = 500
/** 演员列表每页上限。 */
export const ACTOR_PAGE_MAX = 1000
/** 一次刷新最多指定的演员数。 */
const REFRESH_MAX = 5000

const SORTS: readonly ActorSortField[] = ['name', 'works', 'recent']
const GENDERS: readonly ActorGender[] = ['female', 'male']
const SOURCE_IDS = ACTOR_SOURCES.map(s => s.id)
const MEASURES = ['height', 'bust', 'waist', 'hip'] as const

/** 归一化后的列表查询：排序、分页都有确定值。 */
export type NormalizedActorQuery = ActorListQuery &
  Required<Pick<ActorListQuery, 'sort' | 'offset' | 'limit'>>

/** 解析演员列表查询。 */
export function parseActorQuery(input: unknown): NormalizedActorQuery {
  const q = asRecord(input, 'query')
  if (q.search !== undefined && typeof q.search !== 'string') {
    invalid('search 必须是字符串')
  }
  const search = typeof q.search === 'string' ? q.search.trim() : ''
  return {
    libraryId:
      q.libraryId === undefined
        ? undefined
        : positiveId(q.libraryId, 'libraryId'),
    search: search ? search.slice(0, 100) : undefined,
    sort: q.sort === undefined ? 'works' : oneOf(q.sort, SORTS, 'sort'),
    offset: optionalInt(q.offset, 'offset', 0) ?? 0,
    limit: Math.min(
      optionalInt(q.limit, 'limit', 1) ?? ACTOR_PAGE_SIZE,
      ACTOR_PAGE_MAX
    ),
  }
}

/** 可空字符串：去首尾空白，空串当 null，超长拒绝。 */
function text(value: unknown, name: string, max: number): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return invalid(`${name} 必须是字符串或 null`)
  const out = value.trim()
  if (out.length > max) invalid(`${name} 不能超过 ${max} 字`)
  return out || null
}

/** 字符串列表：去空白、去空、去重，限制条数与长度。 */
function textList(
  value: unknown,
  name: string,
  maxItems: number,
  maxLength: number
): string[] {
  if (!Array.isArray(value)) return invalid(`${name} 必须是数组`)
  if (value.length > maxItems) invalid(`${name} 最多 ${maxItems} 项`)
  const out = value.map(v => text(v, name, maxLength))
  return [...new Set(out.filter((v): v is string => Boolean(v)))]
}

/** YYYY-MM-DD 且是真实日期。 */
function birthday(value: unknown): string | null {
  const raw = text(value, 'birthday', 10)
  if (raw === null) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  const date = m ? new Date(`${raw}T00:00:00Z`) : null
  if (!m || !date || date.getUTCDate() !== Number(m[3])) {
    return invalid('birthday 必须是 YYYY-MM-DD')
  }
  return raw
}

/** 身高三围：1–300 的整数或 null。 */
function measure(value: unknown, name: string): number | null {
  if (value === null) return null
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 300
  ) {
    return invalid(`${name} 必须是 1–300 的整数或 null`)
  }
  return value as number
}

/** 解析编辑请求里出现的字段。 */
function parseValues(input: unknown): Partial<ActorProfileValues> {
  const v = asRecord(input, 'values')
  const out: Partial<ActorProfileValues> = {}
  for (const key of Object.keys(v)) {
    if (!(ACTOR_FIELDS as readonly string[]).includes(key)) {
      invalid(`未知字段：${key}`)
    }
  }
  if ('aliases' in v) out.aliases = textList(v.aliases, 'aliases', 50, 100)
  if ('gender' in v) {
    out.gender = v.gender === null ? null : oneOf(v.gender, GENDERS, 'gender')
  }
  if ('birthday' in v) out.birthday = birthday(v.birthday)
  if ('birthplace' in v) out.birthplace = text(v.birthplace, 'birthplace', 100)
  for (const key of MEASURES) if (key in v) out[key] = measure(v[key], key)
  if ('cup' in v) {
    const cup = text(v.cup, 'cup', 2)?.toUpperCase() ?? null
    if (cup !== null && !/^[A-Z]{1,2}$/.test(cup)) invalid('cup 必须是字母')
    out.cup = cup
  }
  if ('overview' in v) out.overview = text(v.overview, 'overview', 5000)
  if ('images' in v) {
    const images = textList(v.images, 'images', 20, 2000)
    if (images.some(url => !/^https?:\/\/\S+$/i.test(url))) {
      invalid('images 必须是 http(s) 地址')
    }
    out.images = images
  }
  return out
}

/** 解析编辑请求。 */
export function parseUpdateActor(input: unknown): UpdateActorRequest {
  const r = asRecord(input, 'actors.update 参数')
  return {
    actorId: positiveId(r.actorId, 'actorId'),
    values: parseValues(r.values),
    lockedFields:
      listOf<ActorField>(r.lockedFields, ACTOR_FIELDS, 'lockedFields') ?? [],
  }
}

/** 解析刷新请求。 */
export function parseRefreshActors(input: unknown): RefreshActorsRequest {
  const r = asRecord(input, 'actors.refresh 参数')
  if (r.actorIds === undefined) return {}
  if (!Array.isArray(r.actorIds) || !r.actorIds.length) {
    return invalid('actorIds 必须是非空数组')
  }
  if (r.actorIds.length > REFRESH_MAX)
    invalid(`actorIds 最多 ${REFRESH_MAX} 个`)
  return {
    actorIds: [...new Set(r.actorIds.map(id => positiveId(id, 'actorIds')))],
  }
}

/** 解析来源设置：sources 为不重复的已知来源，顺序即优先级。 */
export function parseActorSettings(input: unknown): ActorSettings {
  const r = asRecord(input, '演员资料设置')
  if (!Array.isArray(r.sources)) return invalid('sources 必须是数组')
  if (typeof r.autoLookup !== 'boolean') invalid('autoLookup 必须是布尔值')
  const seen = new Set<string>()
  const sources = r.sources.map(item => {
    const s = asRecord(item, 'source')
    const id = oneOf<ActorSourceId>(s.id, SOURCE_IDS, 'source.id')
    if (seen.has(id)) invalid(`来源重复：${id}`)
    seen.add(id)
    if (typeof s.enabled !== 'boolean') invalid('enabled 必须是布尔值')
    return { id, enabled: s.enabled as boolean }
  })
  return { sources, autoLookup: r.autoLookup as boolean }
}

const actorIdParam = (input: unknown): { actorId: number } => ({
  actorId: positiveId(asRecord(input, '参数').actorId, 'actorId'),
})

/** 演员库各方法的参数解析器（并入 validate.ts 的 PARAM_PARSERS）。 */
export const ACTOR_PARSERS = {
  'actors.list': parseActorQuery,
  'actors.get': actorIdParam,
  'actors.forItem': input => ({
    itemId: positiveId(asRecord(input, '参数').itemId, 'itemId'),
  }),
  'actors.update': parseUpdateActor,
  'actors.refresh': parseRefreshActors,
  'actors.cancelRefresh': () => undefined,
  'actors.getSettings': () => undefined,
  'actors.setSettings': parseActorSettings,
} satisfies {
  [M in ActorMethod]: (input: unknown) => ActorRpcMap[M]['params']
}
