/**
 * 海报墙附加筛选（LibraryQueryFilters）的 SQL：评分下限、制片国家、人名、条目 id 白 / 黑名单、有无类型、
 * 内容类别、是否看完、添加时间下限。
 *
 * 国家是 metadata.countries（ISO 代码数组）；人名查 metadata.cast / metadata.crew 的 name 与
 * originalName（包含匹配，不分大小写），番号库再查 item_actors + actors 的演员名。
 */
import {
  CATEGORY_GENRES,
  CATEGORY_GENRE_IDS,
  type MediaCategory,
  SPECIAL_CATEGORIES,
} from '../../../shared/library/category'

type SpecialCategory = (typeof SPECIAL_CATEGORIES)[number]
import type { LibraryQueryFilters } from '../../../shared/library/ipc'

type Params = Array<string | number>

const marks = (n: number): string =>
  Array.from({ length: n }, () => '?').join(', ')

/** LIKE 模式转义（小写后包含匹配）。 */
const likePattern = (text: string): string =>
  `%${text.toLowerCase().replace(/[\\%_]/g, c => `\\${c}`)}%`

/** 一个人参与了该条目（演职员表或演员库）的条件；占 5 个参数。a 是条目表别名。 */
const personClause = (a: string): string => `(
  EXISTS (SELECT 1 FROM json_each(${a}.metadata, '$.cast') j
    WHERE lower(json_extract(j.value, '$.name')) LIKE ? ESCAPE '\\'
       OR lower(coalesce(json_extract(j.value, '$.originalName'), '')) LIKE ? ESCAPE '\\')
  OR EXISTS (SELECT 1 FROM json_each(${a}.metadata, '$.crew') j
    WHERE lower(json_extract(j.value, '$.name')) LIKE ? ESCAPE '\\'
       OR lower(coalesce(json_extract(j.value, '$.originalName'), '')) LIKE ? ESCAPE '\\')
  OR ${a}.id IN (SELECT ia.item_id FROM item_actors ia JOIN actors a ON a.id = ia.actor_id
    WHERE lower(a.name) LIKE ? ESCAPE '\\')
)`

/** 条目有类型：genres 是非空 JSON 数组。alias 是条目表别名。 */
const hasGenres = (alias: string): string =>
  `(${alias}.genres IS NOT NULL AND json_array_length(${alias}.genres) > 0)`

/** 条目命中某个类别：TMDB 类型 id（metadata.genreIds）或类型名（genres）任一在列；参数是 id 再是名字。 */
const genreIn = (alias: string, category: SpecialCategory): string =>
  `(EXISTS (SELECT 1 FROM json_each(${alias}.metadata, '$.genreIds') j WHERE j.value IN (${marks(CATEGORY_GENRE_IDS[category].length)}))
    OR EXISTS (SELECT 1 FROM json_each(${alias}.genres) j WHERE j.value IN (${marks(CATEGORY_GENRES[category].length)})))`

const genreParams = (category: SpecialCategory): Array<string | number> => [
  ...CATEGORY_GENRE_IDS[category],
  ...CATEGORY_GENRES[category],
]

/**
 * 内容类别的条件：命中本类，且不命中优先级更高的类（plain 为三类都不命中）。
 * 与 categoryOf 同一口径。
 */
function categoryClause(
  alias: string,
  category: MediaCategory
): { clause: string; params: Params } {
  const rank = SPECIAL_CATEGORIES.indexOf(category as SpecialCategory)
  const higher =
    rank < 0 ? SPECIAL_CATEGORIES : SPECIAL_CATEGORIES.slice(0, rank)
  const parts: string[] = []
  const params: Params = []
  if (rank >= 0) {
    parts.push(genreIn(alias, SPECIAL_CATEGORIES[rank]))
    params.push(...genreParams(SPECIAL_CATEGORIES[rank]))
  }
  for (const other of higher) {
    parts.push(`NOT ${genreIn(alias, other)}`)
    params.push(...genreParams(other))
  }
  return { clause: `(${parts.join(' AND ')})`, params }
}

/**
 * 条目看完了：电影有一条看完的进度；剧至少有一集带文件，且带文件的集都看完了
 * （集挂在季下或直接挂在剧下都算）。与 ProgressStore.summary 的 watched 同一口径。
 */
const watchedClause = (a: string): string => `(
  (${a}.type = 'movie' AND EXISTS (
    SELECT 1 FROM watch_progress p WHERE p.item_id = ${a}.id AND p.watched = 1))
  OR (${a}.type = 'series' AND EXISTS (${playableEpisodes(a)})
    AND NOT EXISTS (${playableEpisodes(a)} AND NOT EXISTS (
      SELECT 1 FROM watch_progress p WHERE p.item_id = e.id AND p.watched = 1)))
)`

/** 剧下面带文件的集（别名 e），供 EXISTS 使用。 */
const playableEpisodes = (a: string): string =>
  `SELECT 1 FROM media_items e LEFT JOIN media_items s ON s.id = e.parent_id
    WHERE e.type = 'episode' AND (e.parent_id = ${a}.id OR s.parent_id = ${a}.id)
      AND EXISTS (SELECT 1 FROM file_media fm WHERE fm.item_id = e.id)`

/** 附加筛选 → WHERE 子句（AND 连接）与参数；什么都没给返回空数组。alias 是条目表别名。 */
export function filterClauses(
  q: LibraryQueryFilters,
  alias = 'i'
): {
  clauses: string[]
  params: Params
} {
  const clauses: string[] = []
  const params: Params = []
  if (q.ratingMin !== undefined) {
    clauses.push(`${alias}.rating >= ?`)
    params.push(q.ratingMin)
  }
  if (q.countries?.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM json_each(${alias}.metadata, '$.countries') j WHERE upper(j.value) IN (${marks(q.countries.length)}))`
    )
    params.push(...q.countries)
  }
  for (const person of q.people ?? []) {
    clauses.push(personClause(alias))
    const pattern = likePattern(person)
    params.push(pattern, pattern, pattern, pattern, pattern)
  }
  if (q.ids) {
    if (!q.ids.length) clauses.push('0')
    else {
      clauses.push(`${alias}.id IN (SELECT value FROM json_each(?))`)
      params.push(JSON.stringify(q.ids))
    }
  }
  if (q.excludeIds?.length) {
    clauses.push(`${alias}.id NOT IN (SELECT value FROM json_each(?))`)
    params.push(JSON.stringify(q.excludeIds))
  }
  if (q.hasGenres !== undefined) {
    clauses.push(q.hasGenres ? hasGenres(alias) : `NOT ${hasGenres(alias)}`)
  }
  if (q.category !== undefined) {
    const { clause, params: names } = categoryClause(alias, q.category)
    clauses.push(clause)
    params.push(...names)
  }
  if (q.watched !== undefined) {
    const done = watchedClause(alias)
    clauses.push(q.watched ? done : `NOT ${done}`)
  }
  if (q.addedFrom !== undefined) {
    clauses.push(`${alias}.added_at >= ?`)
    params.push(q.addedFrom)
  }
  return { clauses, params }
}
