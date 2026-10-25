/**
 * 海报墙附加筛选（LibraryQueryFilters）的 SQL：评分下限、制片国家、人名、条目 id 白 / 黑名单、有无类型。
 *
 * 国家是 metadata.countries（ISO 代码数组）；人名查 metadata.cast / metadata.crew 的 name 与
 * originalName（包含匹配，不分大小写），番号库再查 item_actors + actors 的演员名。
 */
import type { LibraryQueryFilters } from '../../../shared/library/ipc'

type Params = Array<string | number>

const marks = (n: number): string =>
  Array.from({ length: n }, () => '?').join(', ')

/** LIKE 模式转义（小写后包含匹配）。 */
const likePattern = (text: string): string =>
  `%${text.toLowerCase().replace(/[\\%_]/g, c => `\\${c}`)}%`

/** 一个人参与了该条目（演职员表或演员库）的条件；占 5 个参数。 */
const PERSON_CLAUSE = `(
  EXISTS (SELECT 1 FROM json_each(i.metadata, '$.cast') j
    WHERE lower(json_extract(j.value, '$.name')) LIKE ? ESCAPE '\\'
       OR lower(coalesce(json_extract(j.value, '$.originalName'), '')) LIKE ? ESCAPE '\\')
  OR EXISTS (SELECT 1 FROM json_each(i.metadata, '$.crew') j
    WHERE lower(json_extract(j.value, '$.name')) LIKE ? ESCAPE '\\'
       OR lower(coalesce(json_extract(j.value, '$.originalName'), '')) LIKE ? ESCAPE '\\')
  OR i.id IN (SELECT ia.item_id FROM item_actors ia JOIN actors a ON a.id = ia.actor_id
    WHERE lower(a.name) LIKE ? ESCAPE '\\')
)`

/** 条目有类型：genres 是非空 JSON 数组。 */
const HAS_GENRES = '(i.genres IS NOT NULL AND json_array_length(i.genres) > 0)'

/** 附加筛选 → WHERE 子句（AND 连接）与参数；什么都没给返回空数组。 */
export function filterClauses(q: LibraryQueryFilters): {
  clauses: string[]
  params: Params
} {
  const clauses: string[] = []
  const params: Params = []
  if (q.ratingMin !== undefined) {
    clauses.push('i.rating >= ?')
    params.push(q.ratingMin)
  }
  if (q.countries?.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM json_each(i.metadata, '$.countries') j WHERE upper(j.value) IN (${marks(q.countries.length)}))`
    )
    params.push(...q.countries)
  }
  for (const person of q.people ?? []) {
    clauses.push(PERSON_CLAUSE)
    const pattern = likePattern(person)
    params.push(pattern, pattern, pattern, pattern, pattern)
  }
  if (q.ids) {
    if (!q.ids.length) clauses.push('0')
    else {
      clauses.push('i.id IN (SELECT value FROM json_each(?))')
      params.push(JSON.stringify(q.ids))
    }
  }
  if (q.excludeIds?.length) {
    clauses.push('i.id NOT IN (SELECT value FROM json_each(?))')
    params.push(JSON.stringify(q.excludeIds))
  }
  if (q.hasGenres !== undefined) {
    clauses.push(q.hasGenres ? HAS_GENRES : `NOT ${HAS_GENRES}`)
  }
  return { clauses, params }
}
