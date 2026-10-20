/**
 * 元数据源响应缓存：provider_cache 表（持久化）+ 进程内 LRU（热路径免 JSON.parse）。
 *
 * 过期的条目不立即删除：带 ETag 的可以用 If-None-Match 条件请求续期，304 时直接复用正文。
 */
import { type LibraryDb, StatementCache } from '../../db/database'

/** 一条缓存。body 是原始 JSON 文本；404 记为 'null'。 */
export interface CacheEntry {
  body: string
  etag: string | null
  expiresAt: number
}

/** 缓存接口：测试可用内存实现。 */
export interface ResponseCache {
  get(key: string): CacheEntry | undefined
  set(key: string, entry: CacheEntry, now: number): void
  /** 只延长有效期（304 续期）。 */
  touch(key: string, expiresAt: number, now: number): void
}

/** 内存 LRU：Map 的插入顺序即最近使用顺序。 */
class Lru<V> {
  private readonly map = new Map<string, V>()
  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }

  clear(): void {
    this.map.clear()
  }

  set(key: string, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value!)
    }
  }
}

/** SQLite 缓存，前面挡一层内存 LRU。 */
export class SqliteResponseCache implements ResponseCache {
  private readonly sql: StatementCache
  private readonly memory: Lru<CacheEntry>

  constructor(db: LibraryDb, memoryEntries = 2000) {
    this.sql = new StatementCache(db)
    this.memory = new Lru(memoryEntries)
  }

  get(key: string): CacheEntry | undefined {
    const hit = this.memory.get(key)
    if (hit) return hit
    const row = this.sql
      .get('SELECT body, etag, expires_at FROM provider_cache WHERE key = ?')
      .get(key)
    if (!row) return undefined
    const entry: CacheEntry = {
      body: String(row.body),
      etag: row.etag === null ? null : String(row.etag),
      expiresAt: Number(row.expires_at),
    }
    this.memory.set(key, entry)
    return entry
  }

  set(key: string, entry: CacheEntry, now: number): void {
    this.memory.set(key, entry)
    this.sql
      .get(
        `INSERT INTO provider_cache (key, body, etag, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET body = excluded.body,
           etag = excluded.etag, expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`
      )
      .run(key, entry.body, entry.etag, entry.expiresAt, now)
  }

  touch(key: string, expiresAt: number, now: number): void {
    const hit = this.memory.get(key)
    if (hit) hit.expiresAt = expiresAt
    this.sql
      .get(
        'UPDATE provider_cache SET expires_at = ?, updated_at = ? WHERE key = ?'
      )
      .run(expiresAt, now, key)
  }

  /**
   * 让以这些前缀开头的条目立即过期（刷新元数据时用）。保留正文与 ETag，
   * 下次请求走条件请求，没变化时服务端回 304，几乎不花流量。
   */
  expire(prefixes: string[], now: number): void {
    const stmt = this.sql.get(
      `UPDATE provider_cache SET expires_at = 0, updated_at = ?
       WHERE key >= ? AND key < ?`
    )
    for (const prefix of prefixes) stmt.run(now, prefix, `${prefix}\uffff`)
    this.memory.clear()
  }

  /** 删除过期超过 graceMs 的条目（没有 ETag 的过期即无用），返回删除条数。 */
  prune(now: number, graceMs = 30 * 86_400_000): number {
    return Number(
      this.sql
        .get(
          `DELETE FROM provider_cache
           WHERE expires_at < ? AND (etag IS NULL OR expires_at < ?)`
        )
        .run(now, now - graceMs).changes
    )
  }
}

/** 内存缓存（测试、基准用）。 */
export class MemoryResponseCache implements ResponseCache {
  readonly entries = new Map<string, CacheEntry>()

  get(key: string): CacheEntry | undefined {
    return this.entries.get(key)
  }

  set(key: string, entry: CacheEntry): void {
    this.entries.set(key, { ...entry })
  }

  touch(key: string, expiresAt: number): void {
    const hit = this.entries.get(key)
    if (hit) hit.expiresAt = expiresAt
  }
}
