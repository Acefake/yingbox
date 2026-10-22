/**
 * 媒体库（根目录）的增删查改。根目录之间不允许嵌套，否则同一个文件会属于两个库。
 * 自动化设置整份存 JSON，读取时与默认值合并（旧数据、缺字段都能用）。
 */
import { basename, resolve } from 'node:path'
import {
  type AddLibraryRequest,
  type LibraryAutomation,
  LibraryError,
  type LibraryInfo,
  type LibraryKind,
  type LibrarySource,
  type UpdateLibraryRequest,
  withAutomationDefaults,
} from '../../../shared/library/ipc'
import { type LibraryDb, StatementCache } from '../db/database'
import { pathKey } from '../scanner/rules'

/** 引擎内部用的媒体库记录：比 LibraryInfo 多一个路径键。 */
export interface LibraryRecord extends LibraryInfo {
  rootKey: string
}

const SELECT = `SELECT id, name, root, root_display, kind, source, created_at,
  last_scan_at, automation FROM libraries`

/** 存储里的自动化 JSON → 补全默认值；坏数据按默认值处理。 */
function parseAutomation(raw: unknown): LibraryAutomation {
  try {
    return withAutomationDefaults(
      JSON.parse(String(raw ?? '{}')) as Partial<LibraryAutomation>
    )
  } catch {
    return withAutomationDefaults(null)
  }
}

function toRecord(row: Record<string, unknown>): LibraryRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    root: String(row.root_display),
    rootKey: String(row.root),
    kind: row.kind as LibraryKind,
    source: row.source as LibrarySource,
    createdAt: Number(row.created_at),
    lastScanAt: row.last_scan_at === null ? null : Number(row.last_scan_at),
    automation: parseAutomation(row.automation),
  }
}

/** 去掉内部字段，得到发给渲染进程的 LibraryInfo；cloud 是存储判定结论（还没判定完时省略）。 */
export function toLibraryInfo(
  { rootKey: _, ...info }: LibraryRecord,
  cloud?: boolean
): LibraryInfo {
  return cloud === undefined ? info : { ...info, cloud }
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
    const lib = this.find(id)
    if (!lib) throw new LibraryError('not-found', `媒体库 ${id} 不存在`)
    return lib
  }

  /** 按 id 取；不存在返回 undefined。 */
  find(id: number): LibraryRecord | undefined {
    const row = this.sql.get(`${SELECT} WHERE id = ?`).get(id)
    return row ? toRecord(row) : undefined
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
        `INSERT INTO libraries (root, root_display, kind, source, name, created_at,
           automation)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .get(
        key,
        root,
        request.kind,
        request.source ?? 'tmdb',
        request.name || basename(root) || root,
        now,
        JSON.stringify(withAutomationDefaults(request.automation))
      )!
    return this.get(Number(row.id))
  }

  /** 改名 / 改自动化设置（只改给出的字段），返回修改后的记录；不存在抛 not-found。 */
  update(request: UpdateLibraryRequest): LibraryRecord {
    const current = this.get(request.libraryId)
    const automation = withAutomationDefaults({
      ...current.automation,
      ...request.automation,
    })
    this.sql
      .get('UPDATE libraries SET name = ?, automation = ? WHERE id = ?')
      .run(request.name ?? current.name, JSON.stringify(automation), current.id)
    return this.get(current.id)
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
