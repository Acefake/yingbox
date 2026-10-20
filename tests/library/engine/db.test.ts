import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  openLibraryDb,
  transaction,
} from '../../../src/main/library/db/database'
import {
  MIGRATIONS,
  type Migration,
  migrate,
  schemaVersion,
} from '../../../src/main/library/db/migrations'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const tempDb = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'yingbox-db-'))
  dirs.push(dir)
  return join(dir, 'nested', 'library.db')
}

const tables = (db: DatabaseSync): string[] =>
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )
    .all()
    .map(r => String(r.name))

describe('openLibraryDb', () => {
  it('新建数据库：执行全部迁移，WAL、外键、synchronous=NORMAL 生效', () => {
    const db = openLibraryDb(tempDb())
    expect(schemaVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    expect(tables(db)).toEqual(
      expect.arrayContaining([
        'libraries',
        'dirs',
        'files',
        'media_items',
        'file_media',
        'matches',
        'provider_cache',
        'jobs',
        'media_items_fts',
      ])
    )
    expect(db.prepare('PRAGMA journal_mode').get()!.journal_mode).toBe('wal')
    expect(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys).toBe(1)
    expect(db.prepare('PRAGMA synchronous').get()!.synchronous).toBe(1)
    db.close()
  })

  it('重复打开不重复迁移，数据保留', () => {
    const file = tempDb()
    const a = openLibraryDb(file)
    a.prepare(
      "INSERT INTO libraries (root, root_display, kind, name, created_at) VALUES ('/m', '/m', 'movie', 'm', 1)"
    ).run()
    a.close()
    const b = openLibraryDb(file)
    expect(b.prepare('SELECT COUNT(*) AS n FROM libraries').get()!.n).toBe(1)
    b.close()
  })

  it('删除媒体库级联删除目录、文件、条目和关联', () => {
    const db = openLibraryDb(':memory:')
    db.exec(`
      INSERT INTO libraries (id, root, root_display, kind, name, created_at) VALUES (1, '/m', '/m', 'movie', 'm', 1);
      INSERT INTO dirs (library_id, path, display_path, mtime) VALUES (1, '/m', '/m', 1);
      INSERT INTO files (id, library_id, path, display_path, dir, name, kind, size, mtime, added_at, updated_at)
        VALUES (1, 1, '/m/a.mkv', '/m/a.mkv', '/m', 'a.mkv', 'video', 1, 1, 1, 1);
      INSERT INTO media_items (id, library_id, type, local_key, added_at, updated_at)
        VALUES (1, 1, 'movie', 'k', 1, 1);
      INSERT INTO file_media VALUES (1, 1);
    `)
    db.exec('DELETE FROM libraries')
    for (const t of ['dirs', 'files', 'media_items', 'file_media']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()!.n).toBe(0)
    }
  })
})

describe('migrate', () => {
  const extra: Migration = {
    version: MIGRATIONS.length + 1,
    description: '测试列',
    sql: 'ALTER TABLE libraries ADD COLUMN note TEXT;',
  }

  it('只执行新增的迁移', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(migrate(db, [...MIGRATIONS, extra])).toBe(extra.version)
    const columns = db
      .prepare('PRAGMA table_info(libraries)')
      .all()
      .map(r => r.name)
    expect(columns).toContain('note')
  })

  it('迁移失败时整条回滚，版本不变', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const broken: Migration = {
      ...extra,
      sql: 'ALTER TABLE libraries ADD COLUMN ok TEXT; SELECT * FROM no_such_table;',
    }
    expect(() => migrate(db, [...MIGRATIONS, broken])).toThrow(
      new RegExp(`迁移 ${broken.version}`)
    )
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    const columns = db
      .prepare('PRAGMA table_info(libraries)')
      .all()
      .map(r => r.name)
    expect(columns).not.toContain('ok')
  })

  it('数据库版本高于程序时拒绝打开', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA user_version = 99')
    expect(() => migrate(db)).toThrow(/高于程序支持/)
  })
})

describe('transaction', () => {
  it('抛错回滚；嵌套并入外层', () => {
    const db = openLibraryDb(':memory:')
    const insert = (root: string): void => {
      db.prepare(
        "INSERT INTO libraries (root, root_display, kind, name, created_at) VALUES (?, ?, 'movie', 'x', 1)"
      ).run(root, root)
    }
    expect(() =>
      transaction(db, () => {
        insert('/a')
        transaction(db, () => insert('/b'))
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(db.prepare('SELECT COUNT(*) AS n FROM libraries').get()!.n).toBe(0)
    transaction(db, () => {
      insert('/a')
      transaction(db, () => insert('/b'))
    })
    expect(db.prepare('SELECT COUNT(*) AS n FROM libraries').get()!.n).toBe(2)
  })
})
