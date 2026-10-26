/**
 * 分面筛选的 SQL：把 FacetFilter 编译成海报墙查询的 WHERE 子句，并列出某个分面的取值与条目数。
 *
 * 数据都在 media_items 上：标签是 genres（JSON 数组）；制作商 / 发行商是 metadata.companies，
 * 系列是 metadata.collection.name，导演是 metadata.crew 里 job = Director 的人；
 * 演员走 item_actors + actors（番号库才有）；类型用 jav_kind(tmdb_id)（见 jav-kind.ts）。
 */
import type {
  FacetField,
  FacetFilter,
  FacetListRequest,
  FacetValue,
} from '../../../shared/library/ipc'
import type { StatementCache } from '../db/database'

type Params = Array<string | number>

const marks = (n: number): string =>
  Array.from({ length: n }, () => '?').join(', ')

/**
 * 每个分面「这一行的取值」：each 是展开多值字段的 json_each 表（别名 j），
 * join 是额外连接（演员），value 是取值表达式，where 是展开后的附加条件。
 */
interface ValueSource {
  each?: string
  join?: string
  value: string
  where?: string
}

/** 各分面的取值来源；a 是条目表别名（海报墙用 i，合并去重的子查询用 o）。 */
function valueSource(field: FacetField, a: string): ValueSource {
  switch (field) {
    case 'kind':
      return { value: `jav_kind(${a}.tmdb_id)` }
    case 'tag':
      return { each: `json_each(${a}.genres) j`, value: 'j.value' }
    case 'actor':
      return {
        join: `JOIN item_actors ia ON ia.item_id = ${a}.id JOIN actors a ON a.id = ia.actor_id`,
        value: 'a.name',
      }
    case 'studio':
      return {
        each: `json_each(${a}.metadata, '$.companies') j`,
        value: 'j.value',
      }
    case 'series':
      return { value: `json_extract(${a}.metadata, '$.collection.name')` }
    case 'director':
      return {
        each: `json_each(${a}.metadata, '$.crew') j`,
        value: "json_extract(j.value, '$.name')",
        where: "json_extract(j.value, '$.job') = 'Director'",
      }
  }
}

const FACET_FIELDS: readonly FacetField[] = [
  'kind',
  'tag',
  'actor',
  'studio',
  'series',
  'director',
]

/** 条目在某分面上「取值属于这 n 个之一」的条件（参数由调用方按序追加）。 */
function anyOf(field: FacetField, n: number, a: string): string {
  const src = valueSource(field, a)
  const inList = `${src.value} IN (${marks(n)})`
  if (src.join) {
    return `${a}.id IN (SELECT ia.item_id FROM item_actors ia JOIN actors a ON a.id = ia.actor_id WHERE ${inList})`
  }
  if (!src.each) return inList
  // 多值字段：子查询展开当前条目（a 来自外层）
  const where = [src.where, inList].filter(Boolean).join(' AND ')
  return `EXISTS (SELECT 1 FROM ${src.each} WHERE ${where})`
}

/** FacetFilter → WHERE 子句（AND 连接）与参数；没选任何分面返回空数组。 */
export function facetClauses(
  filter: FacetFilter | undefined,
  alias = 'i'
): {
  clauses: string[]
  params: Params
} {
  const clauses: string[] = []
  const params: Params = []
  if (!filter) return { clauses, params }
  for (const field of FACET_FIELDS) {
    const values = filter[field]
    if (!values?.length) continue
    if (field === 'tag') {
      // 标签要全部带上：每个标签一个条件
      for (const tag of values) {
        clauses.push(anyOf('tag', 1, alias))
        params.push(tag)
      }
    } else {
      clauses.push(anyOf(field, values.length, alias))
      params.push(...values)
    }
  }
  return { clauses, params }
}

/** LIKE 模式转义。 */
const likePattern = (text: string): string =>
  `%${text.replace(/[\\%_]/g, c => `\\${c}`)}%`

/**
 * 列出分面取值：范围是顶层条目（可限定类型 / 来源 / 媒体库），按条目数降序、取值升序。
 * 合并展示的同一作品只算一次（按 merge_key 去重计数）。
 */
export function listFacetValues(
  sql: StatementCache,
  request: FacetListRequest
): FacetValue[] {
  const src = valueSource(request.field, 'i')
  const types = request.types?.length ? request.types : ['movie', 'series']
  const where = [
    `i.type IN (${marks(types.length)})`,
    `${src.value} IS NOT NULL`,
    `${src.value} <> ''`,
  ]
  const params: Params = [...types]
  if (src.where) where.push(src.where)
  if (request.source !== undefined) {
    where.push('i.library_id IN (SELECT id FROM libraries WHERE source = ?)')
    params.push(request.source)
  }
  if (request.libraryId !== undefined) {
    where.push('i.library_id = ?')
    params.push(request.libraryId)
  }
  if (request.search) {
    where.push(`lower(${src.value}) LIKE ? ESCAPE '\\'`)
    params.push(likePattern(request.search.toLowerCase()))
  }
  const rows = sql
    .get(
      `SELECT ${src.value} AS v, COUNT(DISTINCT COALESCE(i.merge_key, i.id)) AS n
       FROM media_items i${src.each ? `, ${src.each}` : ''} ${src.join ?? ''}
       WHERE ${where.join(' AND ')}
       GROUP BY v ORDER BY n DESC, v LIMIT ?`
    )
    .all(...params, request.limit ?? 60)
  return rows.map(row => ({ value: String(row.v), count: Number(row.n) }))
}
