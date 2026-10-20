/**
 * 媒体库（根目录）的增删查。根目录之间不允许嵌套，否则同一个文件会属于两个库。
 */
import { basename, resolve } from 'node:path'
import {
  type AddLibraryRequest,
  LibraryError,
  type LibraryInfo,
  type LibraryKind,
} from '../../../shared/library/ipc'
import { type LibraryDb, StatementCache } from '../db/database'
import { pathKey } from '../scanner/rules'

/** 引擎内部用的媒体库记录：比 LibraryInfo 多一个路径键。 */
export interface LibraryRecord extends LibraryInfo {
  rootKey: string
}

const SELECT = `SELECT id, name, root, root_display, kind, created_at, last_scan_at
FROM libraries`

function toRecord(row: Record<string, unknown>): LibraryRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    root: String(row.root_display),
    rootKey: String(row.root),
    kind: row.kind as LibraryKind,
    createdAt: Number(row.created_at),
    lastScanAt: row.last_scan_at === null ? null : Number(row.last_scan_at),
  }
}

/** 去掉内部字段，得到发给渲染进程的 LibraryInfo。 */
export function toLibraryInfo({
  rootKey: _,
  ...info
}: LibraryRecord): LibraryInfo {
  return info
}

/** 媒体库仓库。 */
export class LibraryStore {
  private readonly sql: StatementCache

  constructor(db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  /** 全部媒体库，按添加顺序。 */
  list(): LibraryRecord[] {
    return this.sql.get(`${SELECT} ORDER BY id`).all().map(toRecord)
  }

  /** 按 id 取；不存在抛 not-found。 */
  get(id: number): LibraryRecord {
    const row = this.sql.get(`${SELECT} WHERE id = ?`).get(id)
    if (!row) throw new LibraryError('not-found', `媒体库 ${id} 不存在`)
    return toRecord(row)
  }

  /** 添加媒体库；与已有根目录相同或互相嵌套时抛 conflict。 */
  add(request: AddLibraryRequest, now: number): LibraryRecord {
    const root = resolve(request.root)
    const key = pathKey(root)
    for (const lib of this.list()) {
      const nested =
        lib.rootKey === key ||
        key.startsWith(`${lib.rootKey}/`) ||
        lib.rootKey.startsWith(`${key}/`)
      if (nested) {
        throw new LibraryError(
          'conflict',
          `与已有媒体库“${lib.name}”（${lib.root}）的目录重叠`
        )
      }
    }
    const row = this.sql
      .get(
        `INSERT INTO libraries (root, root_display, kind, name, created_at)
         VALUES (?, ?, ?, ?, ?) RETURNING id`
      )
      .get(
        key,
        root,
        request.kind,
        request.name || basename(root) || root,
        now
      )!
    return this.get(Number(row.id))
  }

  /** 删除媒体库及其全部目录、文件、条目（外键级联）。 */
  remove(id: number): void {
    const { changes } = this.sql
      .get('DELETE FROM libraries WHERE id = ?')
      .run(id)
    if (!changes) throw new LibraryError('not-found', `媒体库 ${id} 不存在`)
  }

  /** 记录扫描完成时间。 */
  markScanned(id: number, now: number): void {
    this.sql
      .get('UPDATE libraries SET last_scan_at = ? WHERE id = ?')
      .run(now, id)
  }
}
