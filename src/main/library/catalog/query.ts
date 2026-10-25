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
import { VIDEO_RANGE_RANK, type VideoRange } from '../../../shared/video-range'
import { type LibraryDb, StatementCache } from '../db/database'
import { listFacetValues } from './facet-sql'
import { registerJavKind } from './jav-kind'
import { compileListWhere } from './where-sql'

/**
 * 条目自身及子孙（季 / 集）全部文件里最好的动态范围档位；一个都没探测过为 NULL。
 * 合并展示的条目把同键的其它本地条目（另一个文件夹里的同一作品）也算上。
 *
 * 树最多三层（剧 → 季 → 集）：先列出整组的节点 id（成员、子、孙），再按 file_media(item_id) 索引取文件。
 * 不能写成「fm.item_id = … OR fm.item_id IN (…)」：OR 让 file_media 走全表扫描，一部剧就是一遍全表。
 */
const GROUP_MEMBERS = `SELECT i.id UNION
    SELECT m.id FROM media_items m WHERE m.merge_key = i.merge_key`
const GROUP_CHILDREN = `SELECT c.id FROM media_items c WHERE c.parent_id IN (${GROUP_MEMBERS})`
const RANGE_RANK_COLUMN = `(SELECT MAX(CASE f.video_range
    WHEN 'dv' THEN ${VIDEO_RANGE_RANK.dv} WHEN 'hdr10' THEN ${VIDEO_RANGE_RANK.hdr10}
    WHEN 'hlg' THEN ${VIDEO_RANGE_RANK.hlg} WHEN 'sdr' THEN ${VIDEO_RANGE_RANK.sdr} END)
  FROM file_media fm JOIN files f ON f.id = fm.file_id
  WHERE fm.item_id IN (
    ${GROUP_MEMBERS}
    UNION ALL ${GROUP_CHILDREN}
    UNION ALL SELECT e.id FROM media_items e WHERE e.parent_id IN (${GROUP_CHILDREN})
  )) AS range_rank`

const SUMMARY_COLUMNS = `i.id, i.library_id, i.type, i.title, i.original_title, i.year,
  i.match_state, i.tmdb_id, i.imdb_id, i.tvdb_id, i.poster, i.backdrop, i.rating,
  i.added_at, i.updated_at, ${RANGE_RANK_COLUMN}`

/** 档位排名 → 动态范围（与 VIDEO_RANGE_RANK 同序；0 = SDR）。 */
const RANGE_BY_RANK = Object.fromEntries(
  Object.entries(VIDEO_RANGE_RANK).map(([range, rank]) => [rank, range])
) as Record<number, VideoRange>

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

/** 文件行里的探测结果；没探测过（NULL）或读不出（''）时不带。 */
function fileVideo(
  row: Record<string, unknown>
): Pick<LibraryItemFile, 'video'> {
  const range = row.video_range
  if (typeof range !== 'string' || !range) return {}
  return {
    video: {
      range: range as VideoRange,
      dvProfile: row.dv_profile === null ? null : Number(row.dv_profile),
      dvCompat: row.dv_compat === null ? null : Number(row.dv_compat),
    },
  }
}

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
    ...(row.range_rank === null || row.range_rank === undefined
      ? {}
      : { videoRange: RANGE_BY_RANK[Number(row.range_rank)] ?? null }),
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

/** 条目查询仓库。 */
export class CatalogQuery {
  private readonly sql: StatementCache

  constructor(db: LibraryDb) {
    registerJavKind(db)
    this.sql = new StatementCache(db)
  }

  /**
   * 分页列出顶层条目。排序带 id 兜底，翻页稳定；年份 / 评分为空的排在最后。
   *
   * 先只排序取这一页的 id，再给这一页取列表列：动态范围档位是逐行子查询，
   * 排序走不了索引（多类型、按添加时间等）时若和排序写在一起，会对全部命中行都算一遍。
   */
  list(q: NormalizedLibraryQuery): LibraryQueryResult {
    const { with: cte, where, params } = compileListWhere(q)
    const dir = q.order === 'asc' ? 'ASC' : 'DESC'
    const column = SORT_COLUMN[q.sort]
    const nulls =
      q.sort === 'year' || q.sort === 'rating' ? `${column} IS NULL, ` : ''
    const ids = this.sql
      .get(
        `${cte} SELECT i.id FROM media_items i WHERE ${where}
         ORDER BY ${nulls}${column} ${dir}, i.id ${dir} LIMIT ? OFFSET ?`
      )
      .all(...params, q.limit, q.offset)
      .map(r => Number(r.id))
    const byId = new Map<number, LibraryItemSummary>()
    for (const row of this.sql
      .get(
        `SELECT ${SUMMARY_COLUMNS} FROM media_items i
         WHERE i.id IN (SELECT value FROM json_each(?))`
      )
      .all(JSON.stringify(ids))) {
      byId.set(Number(row.id), toSummary(row))
    }
    const total = Number(
      this.sql
        .get(`${cte} SELECT COUNT(*) AS n FROM media_items i WHERE ${where}`)
        .get(...params)!.n
    )
    return {
      items: ids.flatMap(id => byId.get(id) ?? []),
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
        `SELECT fm.item_id, f.id, f.display_path, f.kind, f.size, f.mtime,
                f.video_range, f.dv_profile, f.dv_compat
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
        ...fileVideo(row),
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
