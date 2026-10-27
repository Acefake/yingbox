/**
 * 片库引擎里的刮削偏好（settings 表 `scrape.prefs`，整份 JSON）：宿主经 RPC setScrapePrefs 下发，
 * 识别（TMDB 语言、豆瓣补中文简介）、写出（图片尺寸）、追剧日历每次用时读。
 *
 * 每次读都直接查表（不做进程内缓存）：识别模块、写出模块、RPC 各自 new 一个也不会读到旧值。
 * 没下发过时为默认值（简体中文、高清图片）。
 */
import {
  DEFAULT_SCRAPE_PREFS,
  type ScrapePrefs,
  parseScrapePrefs,
} from '../../../shared/library/scrape-prefs'
import { type LibraryDb, StatementCache } from '../db/database'

/** settings 表里的键。 */
export const SCRAPE_PREFS_KEY = 'scrape.prefs'

/** 刮削偏好仓库。 */
export class ScrapePrefsStore {
  private readonly sql: StatementCache

  constructor(db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  /** 当前偏好；没下发过或存的值坏了时为默认值。 */
  get(): ScrapePrefs {
    const row = this.sql
      .get('SELECT value FROM settings WHERE key = ?')
      .get(SCRAPE_PREFS_KEY)
    if (!row) return structuredClone(DEFAULT_SCRAPE_PREFS)
    try {
      return parseScrapePrefs(JSON.parse(String(row.value)))
    } catch {
      return structuredClone(DEFAULT_SCRAPE_PREFS)
    }
  }

  /** 当前元数据语言。 */
  language(): string {
    return this.get().language
  }

  /** 保存（先按规则解析一遍），返回生效后的值。 */
  set(prefs: ScrapePrefs, now = Date.now()): ScrapePrefs {
    const value = parseScrapePrefs(prefs)
    this.sql
      .get(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value,
           updated_at = excluded.updated_at`
      )
      .run(SCRAPE_PREFS_KEY, JSON.stringify(value), now)
    return value
  }
}

/** 读当前元数据语言的函数（TmdbProvider 的 language 选项、豆瓣补简介用）。 */
export function scrapeLanguage(db: LibraryDb): () => string {
  const store = new ScrapePrefsStore(db)
  return () => store.language()
}
