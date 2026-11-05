/**
 * 占位剧条目（ADR-0049）：追更要的是片库里的剧条目 id，继续播放里的在线剧没有。
 * 这里按剧名 / TMDB id 在片库建一个没有文件的 `series` 条目（`local_key = placeholder:tmdb:<id>`、已锁定匹配），
 * 之后追更、日历把它当普通剧；转存的集入库后，真实条目按 merge_key 与它合并。
 *
 * 匹配复用手动匹配：先建一行临时条目（建时就锁定，匹配期间不会被回收或被识别任务拾取）（`placeholder:pending:<随机>`），匹配成功后换成正式键，失败删掉。
 */
import { randomUUID } from 'node:crypto'

import {
  type ApplyMatchRequest,
  type ApplyMatchResult,
  type EnsureSeriesRequest,
  type EnsureSeriesResult,
  LibraryError,
} from '../../../shared/library/ipc'
import { normalizeTitle } from '../../../shared/library/scoring'
import { type LibraryDb, StatementCache, transaction } from '../db/database'

/** 占位条目的 local_key 前缀；海报墙与版本成员按它排除。 */
export const PLACEHOLDER_PREFIX = 'placeholder:'
const PENDING_PREFIX = `${PLACEHOLDER_PREFIX}pending:`

/** 注入的能力（引擎里接服务的 applyMatch；测试可换假的）。 */
export interface PlaceholderDeps {
  db: LibraryDb
  match(request: ApplyMatchRequest): Promise<ApplyMatchResult>
  now?(): number
}

/** 候选最多返回几个。 */
const MAX_CANDIDATES = 6

/** 同 TMDB id 的剧：日历用的那个（TMDB 来源的剧集库里占位优先、其次 id 最小），排除临时行。 */
const EXISTING_SQL = `SELECT i.id FROM media_items i JOIN libraries l ON l.id = i.library_id
  WHERE i.type = 'series' AND i.merge_key = ?1 AND l.source = 'tmdb'
    AND (l.kind = 'tv' OR l.mixed = 1) AND i.local_key NOT LIKE '${PENDING_PREFIX}%'
  ORDER BY (i.local_key LIKE '${PLACEHOLDER_PREFIX}%') DESC, i.id LIMIT 1`

/** 占位条目的创建。 */
export class PlaceholderSeries {
  private readonly sql: StatementCache

  constructor(private readonly deps: PlaceholderDeps) {
    this.sql = new StatementCache(deps.db)
  }

  /** 保证片库里有这部剧：已有就用，没有就匹配 TMDB 并建占位条目。 */
  async ensure(request: EnsureSeriesRequest): Promise<EnsureSeriesResult> {
    const known = request.tmdbId ? this.existing(request.tmdbId) : null
    if (known !== null)
      return { status: 'ready', itemId: known, created: false }
    const libraryId = this.tvLibrary()
    const temp = this.insertTemp(libraryId, request)
    try {
      const result = await this.deps.match({
        itemId: temp,
        ...(request.tmdbId
          ? { tmdbId: request.tmdbId, lock: true }
          : {
              query: {
                title: request.title,
                ...(request.year ? { year: request.year } : {}),
              },
            }),
      })
      const tmdbId = result.item?.providerIds.tmdb
      if (result.status !== 'matched' || !tmdbId) {
        this.remove(temp)
        const candidates = result.candidates.slice(0, MAX_CANDIDATES)
        return candidates.length
          ? { status: 'choose', candidates }
          : { status: 'none' }
      }
      // 同步段：查重与改键之间没有别的调用插进来
      const dup = this.existing(tmdbId)
      if (dup !== null) {
        this.remove(temp)
        return { status: 'ready', itemId: dup, created: false }
      }
      this.promote(temp, tmdbId)
      return { status: 'ready', itemId: temp, created: true }
    } catch (error) {
      this.remove(temp)
      throw error
    }
  }

  private existing(tmdbId: string): number | null {
    const row = this.sql.get(EXISTING_SQL).get(`series:${tmdbId}`)
    return row ? Number(row.id) : null
  }

  private tvLibrary(): number {
    const row = this.sql
      .get(
        `SELECT id FROM libraries WHERE kind = 'tv' AND source = 'tmdb'
         ORDER BY mixed, id LIMIT 1`
      )
      .get()
    if (!row)
      throw new LibraryError(
        'conflict',
        '还没有剧集媒体库，请先在片库里添加一个剧集库'
      )
    return Number(row.id)
  }

  private insertTemp(libraryId: number, request: EnsureSeriesRequest): number {
    const now = (this.deps.now ?? Date.now)()
    const sort = normalizeTitle(request.title) || request.title
    const row = this.sql
      .get(
        `INSERT INTO media_items (library_id, type, local_key, title, sort_title,
           search_text, year, match_state, added_at, updated_at)
         VALUES (?, 'series', ?, ?, ?, ?, ?, 'locked', ?, ?) RETURNING id`
      )
      .get(
        libraryId,
        `${PENDING_PREFIX}${randomUUID()}`,
        request.title,
        sort,
        sort,
        request.year ?? null,
        now,
        now
      )!
    return Number(row.id)
  }

  private promote(itemId: number, tmdbId: string): void {
    this.sql
      .get(
        `UPDATE media_items SET local_key = ?, match_state = 'locked', updated_at = ?
         WHERE id = ?`
      )
      .run(
        `${PLACEHOLDER_PREFIX}tmdb:${tmdbId}`,
        (this.deps.now ?? Date.now)(),
        itemId
      )
  }

  private remove(itemId: number): void {
    transaction(this.deps.db, () =>
      this.sql.get('DELETE FROM media_items WHERE id = ?').run(itemId)
    )
  }
}
