/**
 * 媒体库 SQLite 连接：基于 Node 内置 node:sqlite（Electron 37 / Node 22.21 自带，免原生编译）。
 *
 * 只在引擎进程里打开一个连接，所有读写都在这个连接上同步执行；扫描等长任务分批提交，
 * 批与批之间让出事件循环，查询不会被整次扫描阻塞。
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { migrate } from './migrations'

/** 引擎使用的数据库句柄。 */
export type LibraryDb = DatabaseSync

let sqlite: typeof import('node:sqlite') | undefined

/**
 * 加载 node:sqlite，并吞掉它在 Node 22 上每次启动都打印的 ExperimentalWarning。
 * utilityProcess 不会把 execArgv 里的 --no-warnings 当作 Node 选项生效（实测），只能在代码里处理；
 * 用 getBuiltinModule 按需加载，保证过滤器先于模块加载装好。
 */
function loadSqlite(): typeof import('node:sqlite') {
  if (sqlite) return sqlite
  const emitWarning = process.emitWarning
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message
    if (!text.includes('SQLite')) {
      ;(emitWarning as (...args: unknown[]) => void).call(
        process,
        warning,
        ...rest
      )
    }
  }) as typeof process.emitWarning
  try {
    sqlite = process.getBuiltinModule('node:sqlite')
  } finally {
    process.emitWarning = emitWarning
  }
  return sqlite
}

/** 打开参数。 */
export interface OpenLibraryDbOptions {
  /** 内存映射大小（字节），默认 256 MiB；0 关闭。 */
  mmapSize?: number
  /** 页缓存大小（KiB），默认 64 MiB。 */
  cacheKiB?: number
}

/**
 * 打开（必要时创建）媒体库数据库，设置 pragma 并执行未完成的迁移。
 *
 * - WAL：读写互不阻塞，崩溃安全；
 * - synchronous=NORMAL：WAL 下只在检查点 fsync，掉电最多丢最后一个事务，不会损坏；
 * - foreign_keys：删除媒体库 / 文件时级联清理；
 * - mmap + cache：查询热路径少走 read 系统调用；
 * - temp_store=MEMORY：排序、FTS 临时表不落盘。
 */
export function openLibraryDb(
  file: string,
  options: OpenLibraryDbOptions = {}
): LibraryDb {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new (loadSqlite().DatabaseSync)(file)
  const mmap = options.mmapSize ?? 256 * 1024 * 1024
  const cache = options.cacheKiB ?? 64 * 1024
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA temp_store = MEMORY;
    PRAGMA busy_timeout = 5000;
    PRAGMA mmap_size = ${Math.max(0, Math.floor(mmap))};
    PRAGMA cache_size = -${Math.max(1024, Math.floor(cache))};
  `)
  migrate(db)
  return db
}

/** 当前连接上嵌套的事务层数；只有最外层真正 BEGIN / COMMIT。 */
const depth = new WeakMap<LibraryDb, number>()

/**
 * 在一个事务里执行 fn；fn 抛出则回滚。嵌套调用并入外层事务。
 * fn 必须是同步的：node:sqlite 是同步 API，跨 await 持有事务会阻塞其他写入。
 */
export function transaction<T>(db: LibraryDb, fn: () => T): T {
  const level = depth.get(db) ?? 0
  if (level > 0) {
    depth.set(db, level + 1)
    try {
      return fn()
    } finally {
      depth.set(db, level)
    }
  }
  db.exec('BEGIN IMMEDIATE')
  depth.set(db, 1)
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    depth.set(db, 0)
  }
}

/**
 * 预编译语句缓存：同一条 SQL 只 prepare 一次。
 * 动态拼接的 SQL（如带不同筛选条件的查询）也能复用，键是 SQL 文本本身。
 */
export class StatementCache {
  private readonly cache = new Map<string, StatementSync>()

  constructor(private readonly db: LibraryDb) {}

  /** 取得（必要时编译）一条语句。 */
  get(sql: string): StatementSync {
    let stmt = this.cache.get(sql)
    if (!stmt) {
      stmt = this.db.prepare(sql)
      this.cache.set(sql, stmt)
    }
    return stmt
  }
}
