/**
 * 引擎测试的公共工具：临时媒体库目录、带内存数据库的扫描环境。
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CatalogStore } from '../../../src/main/library/catalog/catalog-store'
import { CatalogQuery } from '../../../src/main/library/catalog/query'
import {
  type LibraryDb,
  openLibraryDb,
} from '../../../src/main/library/db/database'
import {
  type LibraryRecord,
  LibraryStore,
} from '../../../src/main/library/libraries/library-store'
import {
  type ScanOptions,
  type ScanSummary,
  scanLibrary,
} from '../../../src/main/library/scanner/scan-library'
import { ScanStore } from '../../../src/main/library/scanner/scan-store'
import { fingerprintFile } from '../../../src/main/library/scanner/fingerprint'
import type { LibraryKind } from '../../../src/shared/library/ipc'

/** 临时目录；返回根路径与写文件的工具。 */
export function tempTree(): {
  root: string
  write: (relative: string, content?: string | Buffer) => string
  cleanup: () => void
} {
  const root = mkdtempSync(join(tmpdir(), 'yingbox-lib-test-'))
  return {
    root,
    write: (relative, content = '') => {
      const path = join(root, relative)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
      return path
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

/**
 * 把目录 mtime 往回拨：同一毫秒内的连续改动在部分文件系统上 mtime 不变，
 * 测试里显式让“扫描之后的改动”拥有不同的 mtime。
 */
export function age(path: string, seconds = 60): void {
  const t = new Date(Date.now() - seconds * 1000)
  utimesSync(path, t, t)
}

/** 把整棵目录树（含根）的目录 mtime 都拨回 seconds 秒前，模拟“很久没动过”的真实媒体库。 */
export function ageTree(root: string, seconds = 60): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) ageTree(join(root, entry.name), seconds)
  }
  age(root, seconds)
}

/** 一个媒体库 + 内存数据库的扫描环境。 */
export interface ScanEnv {
  db: LibraryDb
  library: LibraryRecord
  scanStore: ScanStore
  catalog: CatalogStore
  query: CatalogQuery
  scan: (options?: ScanOptions) => Promise<ScanSummary>
  /** 指纹被调用的次数。 */
  fingerprintCalls: () => number
}

/** 建库并返回扫描环境。 */
export function scanEnv(
  root: string,
  kind: LibraryKind = 'movie',
  mixed = false
): ScanEnv {
  const db = openLibraryDb(':memory:')
  const library = new LibraryStore(db).add({ root, kind, mixed }, 1)
  const scanStore = new ScanStore(db)
  const catalog = new CatalogStore(db)
  let calls = 0
  return {
    db,
    library,
    scanStore,
    catalog,
    query: new CatalogQuery(db),
    fingerprintCalls: () => calls,
    scan: options =>
      scanLibrary(
        {
          db,
          scanStore,
          catalog,
          fingerprint: f => {
            calls++
            return fingerprintFile(f.displayPath)
          },
        },
        library,
        options
      ),
  }
}

/** 查一列数字。 */
export function count(
  db: LibraryDb,
  sql: string,
  ...params: Array<string | number>
): number {
  return Number(Object.values(db.prepare(sql).get(...params) ?? { n: 0 })[0])
}
