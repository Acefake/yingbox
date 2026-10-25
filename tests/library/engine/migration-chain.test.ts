/**
 * 迁移链：版本号从 1 连续递增；停在任意旧版本的库都能顺序升级到最新，旧数据保留，
 * 新加的表 / 列在升级后可用（v9 观看进度、v10 合并展示）。
 */
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  MIGRATIONS,
  migrate,
  schemaVersion,
} from '../../../src/main/library/db/migrations'

const LATEST = MIGRATIONS.at(-1)!.version

/** 停在第 version 版的内存库（0 = 空库） */
function dbAt(version: number): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(
    db,
    MIGRATIONS.filter(m => m.version <= version)
  )
  expect(schemaVersion(db)).toBe(version)
  return db
}

/** 插一个媒体库和一部已确认匹配的电影，返回条目 id */
function seedMovie(db: DatabaseSync): number {
  db.prepare(
    `INSERT INTO libraries (root, root_display, kind, name, created_at)
     VALUES ('/m', '/m', 'movie', '电影', 0)`
  ).run()
  const row = db
    .prepare(
      `INSERT INTO media_items
         (library_id, type, local_key, title, tmdb_id, match_state, added_at, updated_at)
       VALUES (1, 'movie', 'movie:/m/a', '盗火线', '949', 'auto', 0, 0)
       RETURNING id`
    )
    .get()
  return Number(row!.id)
}

const columns = (db: DatabaseSync, table: string): string[] =>
  db
    .prepare(`SELECT name FROM pragma_table_xinfo('${table}')`)
    .all()
    .map(r => String(r.name))

describe('迁移链', () => {
  it('版本号从 1 连续递增，v9 观看进度、v10 合并展示', () => {
    expect(MIGRATIONS.map(m => m.version)).toEqual(
      MIGRATIONS.map((_, i) => i + 1)
    )
    expect(MIGRATIONS.find(m => m.version === 9)?.description).toBe('观看进度')
    expect(MIGRATIONS.find(m => m.version === 10)?.description).toBe(
      '同一作品多版本合并展示'
    )
  })

  it('停在任意旧版本的库都能顺序升级到最新', () => {
    for (let v = 0; v < LATEST; v++) {
      const db = dbAt(v)
      expect(migrate(db), `从 v${v} 升级`).toBe(LATEST)
      expect(schemaVersion(db)).toBe(LATEST)
      db.close()
    }
  })

  it('v8 旧库升级：条目保留，观看进度可写，合并键按 TMDB id 生成', () => {
    const db = dbAt(8)
    const id = seedMovie(db)
    migrate(db)
    db.prepare(
      'INSERT INTO watch_progress (item_id, position, duration, updated_at) VALUES (?, 60, 7200, 1)'
    ).run(id)
    expect(
      db
        .prepare('SELECT position FROM watch_progress WHERE item_id = ?')
        .get(id)
    ).toEqual({ position: 60 })
    expect(columns(db, 'media_items')).toEqual(
      expect.arrayContaining(['merge_split', 'merge_key'])
    )
    expect(
      db.prepare('SELECT merge_key FROM media_items WHERE id = ?').get(id)
    ).toEqual({ merge_key: 'movie:949' })
    db.close()
  })

  it('v9 库（已有观看进度）升级到 v10：进度不丢', () => {
    const db = dbAt(9)
    const id = seedMovie(db)
    db.prepare(
      'INSERT INTO watch_progress (item_id, position, duration, updated_at) VALUES (?, 30, 100, 1)'
    ).run(id)
    migrate(db)
    expect(schemaVersion(db)).toBe(LATEST)
    expect(
      db
        .prepare('SELECT position FROM watch_progress WHERE item_id = ?')
        .get(id)
    ).toEqual({ position: 30 })
    db.close()
  })
})
