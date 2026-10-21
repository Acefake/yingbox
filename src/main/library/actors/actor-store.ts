/**
 * 演员库的数据库读写：演员行的增改查、条目 ↔ 演员关联同步、列表与 NFO 用的资料。
 *
 * 写方法都应在调用方的事务里执行。演员只在番号库（libraries.source = 'jav'）的条目上建立关联：
 * TMDB 条目的演职员有 TMDB 人物 id，不进这张表，免得同名不同人混在一起。
 */
import type {
  ActorField,
  ActorListResult,
  ActorProfileState,
  ActorSummary,
  ItemMetadata,
  NormalizedActorQuery,
} from '../../../shared/library/ipc'
import { normalizeTitle } from '../../../shared/library/scoring'
import { type LibraryDb, StatementCache } from '../db/database'
import {
  ACTOR_RETRY_MS,
  type ActorRecord,
  type MergedProfile,
  actorNameKey,
  actorSearchText,
  castNames,
} from './actor-rules'

/** NFO 写出用的演员资料（按名字查）。 */
export interface NfoActorProfile {
  /** 首选头像远程地址。 */
  thumb?: string
  birthday?: string
  birthplace?: string
  height?: number
  /** B-W-H。 */
  measurements?: string
  cup?: string
}

/** 按演员表里的名字查资料（名字先归一，写法略有出入也能对上）。 */
export type NfoActorLookup = Pick<ReadonlyMap<string, NfoActorProfile>, 'get'>

/** trigram 至少 3 个字符才能用 FTS；更短的退回 LIKE。 */
const TRIGRAM_MIN = 3

const SUMMARY_COLUMNS = 'a.id, a.name, a.photo, a.gender'

const SORT_SQL: Record<NormalizedActorQuery['sort'], string> = {
  name: 'a.name COLLATE NOCASE ASC, a.id ASC',
  works: 'works DESC, a.name COLLATE NOCASE ASC, a.id ASC',
  recent: 'recent DESC, a.id DESC',
}

const json = <T>(text: unknown, fallback: T): T => {
  try {
    return text === null || text === undefined
      ? fallback
      : (JSON.parse(String(text)) as T)
  } catch {
    return fallback
  }
}

const str = (v: unknown): string | null => (v === null ? null : String(v))
const num = (v: unknown): number | null => (v === null ? null : Number(v))

function toSummary(row: Record<string, unknown>): ActorSummary {
  return {
    id: Number(row.id),
    name: String(row.name),
    photo: str(row.photo),
    gender: str(row.gender) as ActorSummary['gender'],
    workCount: Number(row.works ?? 0),
  }
}

function toRecord(row: Record<string, unknown>): ActorRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    photo: str(row.photo),
    gender: str(row.gender) as ActorRecord['gender'],
    aliases: json<string[]>(row.aliases, []),
    birthday: str(row.birthday),
    birthplace: str(row.birthplace),
    height: num(row.height),
    bust: num(row.bust),
    waist: num(row.waist),
    hip: num(row.hip),
    cup: str(row.cup),
    overview: str(row.overview),
    tagline: str(row.tagline),
    images: json<string[]>(row.images, []),
    ids: json(row.ids, {}),
    urls: json(row.urls, {}),
    fieldSources: json(row.field_sources, {}),
    lockedFields: json<ActorField[]>(row.locked_fields, []),
    profileState: row.profile_state as ActorProfileState,
    profileAt: num(row.profile_at),
    updatedAt: Number(row.updated_at),
  }
}

/** 演员库仓库。 */
export class ActorStore {
  private readonly sql: StatementCache

  constructor(db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  // —————————————————————————— 关联同步 ——————————————————————————

  /** 这些条目里属于番号库的顶层条目及其元数据。 */
  javItems(
    itemIds: number[] | null
  ): Array<{ id: number; metadata: ItemMetadata | null }> {
    const scope = itemIds ? 'AND i.id IN (SELECT value FROM json_each(?))' : ''
    return this.sql
      .get(
        `SELECT i.id, i.metadata FROM media_items i
         JOIN libraries l ON l.id = i.library_id
         WHERE l.source = 'jav' AND i.parent_id IS NULL ${scope}`
      )
      .all(...(itemIds ? [JSON.stringify(itemIds)] : []))
      .map(r => ({
        id: Number(r.id),
        metadata: json<ItemMetadata | null>(r.metadata, null),
      }))
  }

  /** 按名字确保演员存在，返回 id 与是否新建。 */
  ensure(name: string, now: number): { id: number; created: boolean } {
    const key = actorNameKey(name)
    const row = this.sql
      .get('SELECT id FROM actors WHERE name_key = ?')
      .get(key)
    if (row) return { id: Number(row.id), created: false }
    const inserted = this.sql
      .get(
        `INSERT INTO actors (name, name_key, search_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?) RETURNING id`
      )
      .get(name, key, actorSearchText(name, []), now, now)!
    return { id: Number(inserted.id), created: true }
  }

  /**
   * 按条目元数据的演员表重建它的关联；没有元数据（未匹配）时清空关联。
   * 返回关联前后涉及的演员 id 与本次新建的演员 id。
   */
  syncItem(
    itemId: number,
    meta: ItemMetadata | null,
    now: number
  ): { touched: number[]; created: number[] } {
    const before = this.sql
      .get('SELECT actor_id FROM item_actors WHERE item_id = ?')
      .all(itemId)
      .map(r => Number(r.actor_id))
    this.sql.get('DELETE FROM item_actors WHERE item_id = ?').run(itemId)
    const link = this.sql.get(
      'INSERT OR IGNORE INTO item_actors (item_id, actor_id, ord) VALUES (?, ?, ?)'
    )
    const created: number[] = []
    const after: number[] = []
    castNames(meta).forEach((name, ord) => {
      const actor = this.ensure(name, now)
      if (actor.created) created.push(actor.id)
      after.push(actor.id)
      link.run(itemId, actor.id, ord)
    })
    return { touched: [...new Set([...before, ...after])], created }
  }

  /** 已有作品的演员中，待自动查资料的：从未查过，或上次全部失败且已过重试间隔。 */
  pendingIds(now: number): number[] {
    return this.sql
      .get(
        `SELECT a.id FROM actors a
         WHERE (a.profile_state = 'pending'
                OR (a.profile_state = 'error' AND a.profile_at < ?))
           AND EXISTS (SELECT 1 FROM item_actors ia WHERE ia.actor_id = a.id)
         ORDER BY a.id`
      )
      .all(now - ACTOR_RETRY_MS)
      .map(r => Number(r.id))
  }

  /** 全部有作品的演员。 */
  linkedIds(): number[] {
    return this.sql
      .get('SELECT DISTINCT actor_id FROM item_actors ORDER BY actor_id')
      .all()
      .map(r => Number(r.actor_id))
  }

  // —————————————————————————— 查询 ——————————————————————————

  /** 演员详情的库内部分；不存在返回 null。 */
  record(id: number): ActorRecord | null {
    const row = this.sql.get('SELECT * FROM actors WHERE id = ?').get(id)
    return row ? toRecord(row) : null
  }

  /** 作品数（顶层条目）。 */
  workCount(id: number): number {
    return Number(
      this.sql
        .get('SELECT COUNT(*) AS n FROM item_actors WHERE actor_id = ?')
        .get(id)!.n
    )
  }

  /** 分页列出有作品的演员。 */
  list(q: NormalizedActorQuery): ActorListResult {
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (q.libraryId !== undefined) {
      clauses.push('i.library_id = ?')
      params.push(q.libraryId)
    }
    if (q.search) {
      const term = normalizeTitle(q.search) || q.search.toLowerCase()
      if ([...term].length >= TRIGRAM_MIN) {
        clauses.push(
          'a.id IN (SELECT rowid FROM actors_fts WHERE actors_fts MATCH ?)'
        )
        params.push(`"${term.replace(/"/g, '""')}"`)
      } else {
        clauses.push("a.search_text LIKE ? ESCAPE '\\'")
        params.push(`%${term.replace(/[\\%_]/g, c => `\\${c}`)}%`)
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const from = `FROM actors a JOIN item_actors ia ON ia.actor_id = a.id
      JOIN media_items i ON i.id = ia.item_id ${where}`
    const rows = this.sql
      .get(
        `SELECT ${SUMMARY_COLUMNS}, COUNT(*) AS works, MAX(i.added_at) AS recent
         ${from} GROUP BY a.id ORDER BY ${SORT_SQL[q.sort]} LIMIT ? OFFSET ?`
      )
      .all(...params, q.limit, q.offset)
    const total = Number(
      this.sql.get(`SELECT COUNT(DISTINCT a.id) AS n ${from}`).get(...params)!.n
    )
    return {
      items: rows.map(toSummary),
      total,
      offset: q.offset,
      limit: q.limit,
    }
  }

  /** 条目的演员，按演员表顺序。 */
  forItem(itemId: number): ActorSummary[] {
    return this.sql
      .get(
        `SELECT ${SUMMARY_COLUMNS},
           (SELECT COUNT(*) FROM item_actors x WHERE x.actor_id = a.id) AS works
         FROM item_actors ia JOIN actors a ON a.id = ia.actor_id
         WHERE ia.item_id = ? ORDER BY ia.ord, a.id`
      )
      .all(itemId)
      .map(toSummary)
  }

  /** 条目演员的 NFO 资料（按演员表里的名字查）。 */
  nfoProfiles(itemId: number): NfoActorLookup {
    const out = new Map<string, NfoActorProfile>()
    const rows = this.sql
      .get(
        `SELECT a.* FROM item_actors ia JOIN actors a ON a.id = ia.actor_id
         WHERE ia.item_id = ?`
      )
      .all(itemId)
    for (const row of rows) {
      const r = toRecord(row)
      const { bust, waist, hip } = r
      out.set(actorNameKey(r.name), {
        ...(r.images[0] ? { thumb: r.images[0] } : {}),
        ...(r.birthday ? { birthday: r.birthday } : {}),
        ...(r.birthplace ? { birthplace: r.birthplace } : {}),
        ...(r.height ? { height: r.height } : {}),
        ...(bust && waist && hip
          ? { measurements: `${bust}-${waist}-${hip}` }
          : {}),
        ...(r.cup ? { cup: r.cup } : {}),
      })
    }
    return { get: name => out.get(actorNameKey(name)) }
  }

  // —————————————————————————— 写入 ——————————————————————————

  /** 写回合并后的资料（自动查询或手动编辑）。 */
  writeProfile(
    id: number,
    name: string,
    profile: Pick<MergedProfile, 'values' | 'fieldSources'> &
      Partial<Pick<MergedProfile, 'tagline' | 'ids' | 'urls'>>,
    extra: {
      photo: string | null
      lockedFields?: ActorField[]
      state?: ActorProfileState
      now: number
    }
  ): void {
    const v = profile.values
    this.sql
      .get(
        `UPDATE actors SET search_text = ?, aliases = ?, gender = ?, birthday = ?,
           birthplace = ?, height = ?, bust = ?, waist = ?, hip = ?, cup = ?,
           overview = ?, images = ?, photo = ?, field_sources = ?,
           tagline = COALESCE(?, tagline), ids = COALESCE(?, ids), urls = COALESCE(?, urls),
           locked_fields = COALESCE(?, locked_fields),
           profile_state = COALESCE(?, profile_state),
           profile_at = CASE WHEN ? IS NULL THEN profile_at ELSE ? END,
           updated_at = ?
         WHERE id = ?`
      )
      .run(
        actorSearchText(name, v.aliases),
        JSON.stringify(v.aliases),
        v.gender,
        v.birthday,
        v.birthplace,
        v.height,
        v.bust,
        v.waist,
        v.hip,
        v.cup,
        v.overview,
        JSON.stringify(v.images),
        extra.photo,
        JSON.stringify(profile.fieldSources),
        profile.tagline ?? null,
        profile.ids ? JSON.stringify(profile.ids) : null,
        profile.urls ? JSON.stringify(profile.urls) : null,
        extra.lockedFields ? JSON.stringify(extra.lockedFields) : null,
        extra.state ?? null,
        extra.state ?? null,
        extra.now,
        extra.now,
        id
      )
  }

  /** 演员是否还在（任务跑到一半被删的情况）。 */
  exists(id: number): boolean {
    return Boolean(
      this.sql.get('SELECT 1 AS x FROM actors WHERE id = ?').get(id)
    )
  }
}
