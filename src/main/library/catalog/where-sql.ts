/**
 * 海报墙查询的 WHERE：把查询条件编译成 SQL 子句与参数，并按 merge_key 去掉同一作品的重复条目。
 *
 * 去重规则：一组同键条目里，满足全部筛选条件、id 最小的那个代表整组出现在列表里。
 * 判断「有没有 id 更小、也满足条件的同键条目」是 media_items_merge 索引上的一次探测，只对有键的行发生
 * （INDEXED BY 钉死，免得来源 / 媒体库条件把它带去别的索引）。同一套条件用别名 o 再编译一遍，
 * 所以搜索、分面、年份、媒体库等任何筛选下都恰好出现一次（不会因为代表条目恰好不满足条件而整组消失）。
 *
 * FTS 片名搜索的命中集写成物化 CTE（fts_hits），i 与 o 两边共用一次全文检索；
 * 直接写在相关子查询里时，每探测一行都要重查一遍 FTS。
 */
import type { NormalizedLibraryQuery } from '../../../shared/library/ipc'
import { normalizeTitle } from '../../../shared/library/scoring'
import { facetClauses } from './facet-sql'
import { filterClauses } from './filter-sql'

type Params = Array<string | number>

/** trigram 至少 3 个字符才能用 FTS；更短的查询退回 LIKE。 */
const TRIGRAM_MIN = 3

/** FTS5 短语：整体加双引号，内部双引号转义，避免用户输入被当成查询语法。 */
const ftsPhrase = (text: string): string => `"${text.replace(/"/g, '""')}"`

/** LIKE 模式转义。 */
const likePattern = (text: string): string =>
  `%${text.replace(/[\\%_]/g, c => `\\${c}`)}%`

const marks = (n: number): string =>
  Array.from({ length: n }, () => '?').join(', ')

/** 片名搜索要走 FTS 时的检索词（已归一化）；不搜索或太短（走 LIKE）为 null。 */
function ftsTerm(q: NormalizedLibraryQuery): string | null {
  if (!q.search) return null
  const term = normalizeTitle(q.search) || q.search.toLowerCase()
  return [...term].length >= TRIGRAM_MIN ? term : null
}

/**
 * 把查询条件编译成 WHERE 子句与参数（不含去重）。
 * @param a 条目表别名
 * @param ftsFrom FTS 命中集的表名（由调用方用 CTE 提供）；缺省时内联 FTS 子查询
 */
export function compileWhere(
  q: NormalizedLibraryQuery,
  a: string,
  ftsFrom?: string
): { where: string; params: Params } {
  const clauses: string[] = [`${a}.type IN (${marks(q.types.length)})`]
  const params: Params = [...q.types]
  if (q.libraryId !== undefined) {
    clauses.push(`${a}.library_id = ?`)
    params.push(q.libraryId)
  }
  if (q.source !== undefined) {
    // 库只有寥寥几个，子查询结果很小；按来源把番号库与普通片库分开
    clauses.push(
      `${a}.library_id IN (SELECT id FROM libraries WHERE source = ?)`
    )
    params.push(q.source)
  }
  if (q.actorId !== undefined) {
    clauses.push(
      `${a}.id IN (SELECT item_id FROM item_actors WHERE actor_id = ?)`
    )
    params.push(q.actorId)
  }
  if (q.yearFrom !== undefined) {
    clauses.push(`${a}.year >= ?`)
    params.push(q.yearFrom)
  }
  if (q.yearTo !== undefined) {
    clauses.push(`${a}.year <= ?`)
    params.push(q.yearTo)
  }
  if (q.matchStates) {
    clauses.push(`${a}.match_state IN (${marks(q.matchStates.length)})`)
    params.push(...q.matchStates)
  }
  if (q.search) {
    const term = normalizeTitle(q.search) || q.search.toLowerCase()
    if (ftsTerm(q) !== null && ftsFrom) {
      // 一元 + 让这一项只做成员判断：否则去重子查询会拿命中集逐个去探 merge 索引
      clauses.push(`+${a}.id IN ${ftsFrom}`)
    } else if (ftsTerm(q) !== null) {
      clauses.push(
        `${a}.id IN (SELECT rowid FROM media_items_fts WHERE media_items_fts MATCH ?)`
      )
      params.push(ftsPhrase(term))
    } else {
      clauses.push(`${a}.search_text LIKE ? ESCAPE '\\'`)
      params.push(likePattern(term))
    }
  }
  for (const part of [facetClauses(q.facets, a), filterClauses(q, a)]) {
    clauses.push(...part.clauses)
    params.push(...part.params)
  }
  return { where: clauses.join(' AND '), params }
}

/** 编译好的列表条件：with 放在 SELECT 前面（没有时为空串），params 按文本顺序排好。 */
export interface ListWhere {
  with: string
  where: string
  params: Params
}

/** 海报墙列表的条件（别名 i）：筛选条件 + 同一作品只留一条。 */
export function compileListWhere(q: NormalizedLibraryQuery): ListWhere {
  const term = ftsTerm(q)
  const hits = term === null ? undefined : 'fts_hits'
  const own = compileWhere(q, 'i', hits)
  const other = compileWhere(q, 'o', hits)
  return {
    with:
      term === null
        ? ''
        : `WITH fts_hits(id) AS MATERIALIZED (
             SELECT rowid FROM media_items_fts WHERE media_items_fts MATCH ?)`,
    where: `${own.where} AND (i.merge_key IS NULL OR NOT EXISTS (
      SELECT 1 FROM media_items o INDEXED BY media_items_merge
      WHERE o.merge_key = i.merge_key AND o.id < i.id AND ${other.where}))`,
    params: [
      ...(term === null ? [] : [ftsPhrase(term)]),
      ...own.params,
      ...other.params,
    ],
  }
}
