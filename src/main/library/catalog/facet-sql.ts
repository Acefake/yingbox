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

const VALUE_SOURCES: Record<FacetField, ValueSource> = {
  kind: { value: 'jav_kind(i.tmdb_id)' },
  tag: { each: 'json_each(i.genres) j', value: 'j.value' },
  actor: {
    join: 'JOIN item_actors ia ON ia.item_id = i.id JOIN actors a ON a.id = ia.actor_id',
    value: 'a.name',
  },
  studio: { each: "json_each(i.metadata, '$.companies') j", value: 'j.value' },
  series: { value: "json_extract(i.metadata, '$.collection.name')" },
  director: {
    each: "json_each(i.metadata, '$.crew') j",
    value: "json_extract(j.value, '$.name')",
    where: "json_extract(j.value, '$.job') = 'Director'",
  },
}

/** 条目在某分面上「取值属于这 n 个之一」的条件（参数由调用方按序追加）。 */
function anyOf(field: FacetField, n: number): string {
  const src = VALUE_SOURCES[field]
  const inList = `${src.value} IN (${marks(n)})`
  if (src.join) {
    return `i.id IN (SELECT ia.item_id FROM item_actors ia JOIN actors a ON a.id = ia.actor_id WHERE ${inList})`
  }
  if (!src.each) return inList
  // 多值字段：子查询展开当前条目（i 来自外层）
  const where = [src.where, inList].filter(Boolean).join(' AND ')
  return `EXISTS (SELECT 1 FROM ${src.each} WHERE ${where})`
}

/** FacetFilter → WHERE 子句（AND 连接）与参数；没选任何分面返回空数组。 */
export function facetClauses(filter: FacetFilter | undefined): {
  clauses: string[]
  params: Params
} {
  const clauses: string[] = []
  const params: Params = []
  if (!filter) return { clauses, params }
  for (const field of Object.keys(VALUE_SOURCES) as FacetField[]) {
    const values = filter[field]
    if (!values?.length) continue
    if (field === 'tag') {
      // 标签要全部带上：每个标签一个条件
      for (const tag of values) {
        clauses.push(anyOf('tag', 1))
        params.push(tag)
      }
    } else {
      clauses.push(anyOf(field, values.length))
      params.push(...values)
    }
  }
  return { clauses, params }
}

/** LIKE 模式转义。 */
const likePattern = (text: string): string =>
  `%${text.replace(/[\\%_]/g, c => `\\${c}`)}%`

/** 列出分面取值：范围是顶层条目（可限定来源 / 媒体库），按条目数降序、取值升序。 */
export function listFacetValues(
  sql: StatementCache,
  request: FacetListRequest
): FacetValue[] {
  const src = VALUE_SOURCES[request.field]
  const where = [
    "i.type IN ('movie', 'series')",
    `${src.value} IS NOT NULL`,
    `${src.value} <> ''`,
  ]
  const params: Params = []
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
      `SELECT ${src.value} AS v, COUNT(DISTINCT i.id) AS n
       FROM media_items i${src.each ? `, ${src.each}` : ''} ${src.join ?? ''}
       WHERE ${where.join(' AND ')}
       GROUP BY v ORDER BY n DESC, v LIMIT ?`
    )
    .all(...params, request.limit ?? 60)
  return rows.map(row => ({ value: String(row.v), count: Number(row.n) }))
}
