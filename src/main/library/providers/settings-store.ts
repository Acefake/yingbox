/**
 * 引擎侧设置（settings 表）：目前存元数据源令牌。
 *
 * 令牌只在引擎进程内存与数据库里，不写日志、不回传渲染进程（状态接口只回 configured）。
 * 数据库在用户数据目录，与浏览器 localStorage 同等的本机保护级别。
 */
import { type LibraryDb, StatementCache } from '../db/database'

/** 设置键。 */
export const SETTING_KEYS = {
  tmdbToken: 'provider.tmdb.token',
  opensubtitlesKey: 'provider.opensubtitles.key',
} as const

/** 键值设置仓库，读取有内存缓存。 */
export class SettingsStore {
  private readonly sql: StatementCache
  private readonly cache = new Map<string, string | undefined>()

  constructor(db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  get(key: string): string | undefined {
    if (this.cache.has(key)) return this.cache.get(key)
    const row = this.sql
      .get('SELECT value FROM settings WHERE key = ?')
      .get(key)
    const value = row ? String(row.value) : undefined
    this.cache.set(key, value)
    return value
  }

  /** 写入；value 为 null 时删除。 */
  set(key: string, value: string | null, now: number): void {
    if (value === null) {
      this.sql.get('DELETE FROM settings WHERE key = ?').run(key)
    } else {
      this.sql
        .get(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value,
             updated_at = excluded.updated_at`
        )
        .run(key, value, now)
    }
    this.cache.set(key, value ?? undefined)
  }
}
