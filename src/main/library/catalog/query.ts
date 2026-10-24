/**
 * 条目查询：海报墙分页列表（筛选、分面、排序、FTS 片名搜索）与单个条目详情树。
 */
import type {
  FacetListRequest,
  FacetValue,
  ItemMetadata,
  LibraryFileKind,
  LibraryItemFile,
  LibraryItemNode,
  LibraryItemSummary,
  LibraryQueryResult,
  LibrarySortField,
  MatchState,
  MediaItemType,
} from '../../../shared/library/ipc'
import type { NormalizedLibraryQuery } from '../../../shared/library/ipc'
import { normalizeTitle } from '../../../shared/library/scoring'
import { type LibraryDb, StatementCache } from '../db/database'
import { facetClauses, listFacetValues } from './facet-sql'
import { filterClauses } from './filter-sql'
import { registerJavKind } from './jav-kind'

const SUMMARY_COLUMNS = `i.id, i.library_id, i.type, i.title, i.original_title, i.year,
  i.match_state, i.tmdb_id, i.imdb_id, i.tvdb_id, i.poster, i.backdrop, i.rating,
  i.added_at, i.updated_at`

/** 详情额外的列。 */
const DETAIL_COLUMNS = `i.parent_id, i.season_number, i.episode_number, i.overview,
  i.logo, i.runtime, i.genres, i.air_date, i.metadata`

const SORT_COLUMN: Record<LibrarySortField, string> = {
  title: 'i.sort_title',
  year: 'i.year',
  rating: 'i.rating',
  addedAt: 'i.added_at',
  updatedAt: 'i.updated_at',
}

/** trigram 至少 3 个字符才能用 FTS；更短的查询退回 LIKE。 */
const TRIGRAM_MIN = 3

function toSummary(row: Record<string, unknown>): LibraryItemSummary {
  const providerIds: LibraryItemSummary['providerIds'] = {}
  if (row.tmdb_id !== null) providerIds.tmdb = String(row.tmdb_id)
  if (row.imdb_id !== null) providerIds.imdb = String(row.imdb_id)
  if (row.tvdb_id !== null) providerIds.tvdb = String(row.tvdb_id)
  return {
    id: Number(row.id),
    libraryId: Number(row.library_id),
    type: row.type as MediaItemType,
    title: String(row.title),
    originalTitle:
      row.original_title === null ? null : String(row.original_title),
    year: row.year === null ? null : Number(row.year),
    matchState: row.match_state as MatchState,
    providerIds,
    poster: row.poster === null ? null : String(row.poster),
    backdrop: row.backdrop === null ? null : String(row.backdrop),
    rating: row.rating === null ? null : Number(row.rating),
    addedAt: Number(row.added_at),
    updatedAt: Number(row.updated_at),
  }
}

function parseJson<T>(text: unknown): T | null {
  if (text === null || text === undefined) return null
  try {
    return JSON.parse(String(text)) as T
  } catch {
    return null
  }
}

/** FTS5 短语：整体加双引号，内部双引号转义，避免用户输入被当成查询语法。 */
const ftsPhrase = (text: string): string => `"${text.replace(/"/g, '""')}"`

/** LIKE 模式转义。 */
const likePattern = (text: string): string =>
  `%${text.replace(/[\\%_]/g, c => `\\${c}`)}%`

/** 把查询条件编译成 WHERE 子句与参数。 */
function compileWhere(q: NormalizedLibraryQuery): {
  where: string
  params: Array<string | number>
} {
  const clauses: string[] = []
  const params: Array<string | number> = []
  clauses.push(`i.type IN (${q.types.map(() => '?').join(', ')})`)
  params.push(...q.types)
  if (q.libraryId !== undefined) {
    clauses.push('i.library_id = ?')
    params.push(q.libraryId)
  }
  if (q.source !== undefined) {
    // 库只有寥寥几个，子查询结果很小；按来源把番号库与普通片库分开
    clauses.push('i.library_id IN (SELECT id FROM libraries WHERE source = ?)')
    params.push(q.source)
  }
  if (q.actorId !== undefined) {
    clauses.push('i.id IN (SELECT item_id FROM item_actors WHERE actor_id = ?)')
    params.push(q.actorId)
  }
  if (q.yearFrom !== undefined) {
    clauses.push('i.year >= ?')
    params.push(q.yearFrom)
  }
  if (q.yearTo !== undefined) {
    clauses.push('i.year <= ?')
    params.push(q.yearTo)
  }
  if (q.matchStates) {
    clauses.push(
      `i.match_state IN (${q.matchStates.map(() => '?').join(', ')})`
    )
    params.push(...q.matchStates)
  }
  if (q.search) {
    const term = normalizeTitle(q.search) || q.search.toLowerCase()
    if ([...term].length >= TRIGRAM_MIN) {
      clauses.push(
        'i.id IN (SELECT rowid FROM media_items_fts WHERE media_items_fts MATCH ?)'
      )
      params.push(ftsPhrase(term))
    } else {
      clauses.push("i.search_text LIKE ? ESCAPE '\\'")
      params.push(likePattern(term))
    }
  }
  const facets = facetClauses(q.facets)
  clauses.push(...facets.clauses)
  params.push(...facets.params)
  const filters = filterClauses(q)
  clauses.push(...filters.clauses)
  params.push(...filters.params)
  return { where: clauses.join(' AND '), params }
}

/** 条目查询仓库。 */
export class CatalogQuery {
  private readonly sql: StatementCache

  constructor(db: LibraryDb) {
    registerJavKind(db)
    this.sql = new StatementCache(db)
  }

  /** 分页列出顶层条目。排序带 id 兜底，翻页稳定；年份 / 评分为空的排在最后。 */
  list(q: NormalizedLibraryQuery): LibraryQueryResult {
    const { where, params } = compileWhere(q)
    const dir = q.order === 'asc' ? 'ASC' : 'DESC'
    const column = SORT_COLUMN[q.sort]
    const nulls =
      q.sort === 'year' || q.sort === 'rating' ? `${column} IS NULL, ` : ''
    const rows = this.sql
      .get(
        `SELECT ${SUMMARY_COLUMNS} FROM media_items i WHERE ${where}
         ORDER BY ${nulls}${column} ${dir}, i.id ${dir} LIMIT ? OFFSET ?`
      )
      .all(...params, q.limit, q.offset)
    const total = Number(
      this.sql
        .get(`SELECT COUNT(*) AS n FROM media_items i WHERE ${where}`)
        .get(...params)!.n
    )
    return {
      items: rows.map(toSummary),
      total,
      offset: q.offset,
      limit: q.limit,
    }
  }

  /** 某个分面的取值与条目数（筛选面板用）。 */
  facetValues(request: FacetListRequest): FacetValue[] {
    return listFacetValues(this.sql, request)
  }

  /** 单个条目的列表形状；不存在返回 null。 */
  summary(id: number): LibraryItemSummary | null {
    const row = this.sql
      .get(`SELECT ${SUMMARY_COLUMNS} FROM media_items i WHERE i.id = ?`)
      .get(id)
    return row ? toSummary(row) : null
  }

  /** 条目详情：自身、全部子孙（季 / 集）以及每个节点关联的文件。不存在返回 null。 */
  getItem(id: number): LibraryItemNode | null {
    const rows = this.sql
      .get(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM media_items WHERE id = ?
           UNION ALL
           SELECT c.id FROM media_items c JOIN tree t ON c.parent_id = t.id
         )
         SELECT ${SUMMARY_COLUMNS}, ${DETAIL_COLUMNS}
         FROM media_items i JOIN tree USING (id)
         ORDER BY i.season_number IS NULL, i.season_number,
                  i.episode_number IS NULL, i.episode_number, i.id`
      )
      .all(id)
    if (!rows.length) return null

    const nodes = new Map<number, LibraryItemNode>()
    for (const row of rows) {
      nodes.set(Number(row.id), {
        ...toSummary(row),
        seasonNumber:
          row.season_number === null ? null : Number(row.season_number),
        episodeNumber:
          row.episode_number === null ? null : Number(row.episode_number),
        overview: row.overview === null ? null : String(row.overview),
        logo: row.logo === null ? null : String(row.logo),
        runtime: row.runtime === null ? null : Number(row.runtime),
        genres: parseJson<string[]>(row.genres) ?? [],
        airDate: row.air_date === null ? null : String(row.air_date),
        metadata: parseJson<ItemMetadata>(row.metadata),
        files: [],
        children: [],
      })
    }
    const ids = [...nodes.keys()]
    const files = this.sql
      .get(
        `SELECT fm.item_id, f.id, f.display_path, f.kind, f.size, f.mtime
         FROM file_media fm JOIN files f ON f.id = fm.file_id
         WHERE fm.item_id IN (SELECT value FROM json_each(?))
         ORDER BY f.display_path`
      )
      .all(JSON.stringify(ids))
    for (const row of files) {
      const file: LibraryItemFile = {
        id: Number(row.id),
        path: String(row.display_path),
        kind: row.kind as LibraryFileKind,
        size: Number(row.size),
        mtime: Number(row.mtime),
      }
      nodes.get(Number(row.item_id))?.files.push(file)
    }
    for (const row of rows) {
      if (Number(row.id) === id) continue
      nodes
        .get(Number(row.parent_id))
        ?.children.push(nodes.get(Number(row.id))!)
    }
    return nodes.get(id)!
  }
}
