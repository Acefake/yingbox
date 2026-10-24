/**
 * 扫描器的数据库读写：提供快照（上次扫描结果），以及把差异写回 dirs / files。
 * 写方法都应在调用方的事务里执行。
 */
import type { LibraryFileKind } from '../../../shared/library/ipc'
import type { VideoProbe } from '../../../shared/video-range'
import { type LibraryDb, StatementCache } from '../db/database'
import { subtreeRange } from './rules'
import type {
  DirChange,
  ScanSnapshot,
  ScannedFile,
  StoredDir,
  StoredFile,
} from './types'

const FILE_COLUMNS =
  'id, path, display_path, dir, name, kind, size, mtime, fingerprint'

function toStoredFile(row: Record<string, unknown>): StoredFile {
  return {
    id: Number(row.id),
    key: String(row.path),
    displayPath: String(row.display_path),
    dir: String(row.dir),
    name: String(row.name),
    kind: row.kind as LibraryFileKind,
    size: Number(row.size),
    mtime: Number(row.mtime),
    fingerprint: row.fingerprint === null ? null : String(row.fingerprint),
  }
}

/** 解析结果的写入形式。 */
export interface ParsedColumns {
  /** JSON；解析失败或非视频为 null。 */
  parsed: string | null
  parserVersion: number
  state: 'pending' | 'parsed' | 'error'
}

/** dirs / files 仓库。 */
export class ScanStore {
  private readonly sql: StatementCache

  constructor(db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  /**
   * 读取某个媒体库的快照：目录整表读进内存（万级，几毫秒），
   * 文件按目录按需查询（走 files_dir 索引），无变化重扫不读任何文件行。
   */
  snapshot(libraryId: number): ScanSnapshot {
    const dirs = new Map<string, StoredDir>()
    const children = new Map<string, StoredDir[]>()
    for (const row of this.sql
      .get(
        'SELECT path, display_path, parent, mtime FROM dirs WHERE library_id = ?'
      )
      .iterate(libraryId)) {
      const dir: StoredDir = {
        key: String(row.path),
        displayPath: String(row.display_path),
        mtime: Number(row.mtime),
      }
      dirs.set(dir.key, dir)
      if (row.parent !== null) {
        const parent = String(row.parent)
        const list = children.get(parent)
        if (list) list.push(dir)
        else children.set(parent, [dir])
      }
    }
    const filesIn = this.sql.get(
      `SELECT ${FILE_COLUMNS} FROM files WHERE dir = ?`
    )
    const filesUnder = this.sql.get(
      `SELECT ${FILE_COLUMNS} FROM files WHERE path > ? AND path < ?`
    )
    return {
      getDir: key => dirs.get(key),
      childDirs: key => children.get(key) ?? [],
      filesIn: key => filesIn.all(key).map(toStoredFile),
      filesUnder: key => filesUnder.all(...subtreeRange(key)).map(toStoredFile),
    }
  }

  /** 写入目录记录（新增或更新 mtime）。 */
  upsertDir(libraryId: number, dir: DirChange['dir']): void {
    this.sql
      .get(
        `INSERT INTO dirs (library_id, path, display_path, parent, mtime)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET
           display_path = excluded.display_path, mtime = excluded.mtime`
      )
      .run(libraryId, dir.key, dir.displayPath, dir.parent, dir.mtime)
  }

  /** 删除一棵子树：目录自身、全部子目录和其下文件（文件的关联随外键级联删除）。 */
  deleteSubtree(key: string): void {
    const [lower, upper] = subtreeRange(key)
    this.sql
      .get('DELETE FROM files WHERE path > ? AND path < ?')
      .run(lower, upper)
    this.sql
      .get('DELETE FROM dirs WHERE path = ? OR (path > ? AND path < ?)')
      .run(key, lower, upper)
  }

  /** 插入新文件，返回 id。 */
  insertFile(
    libraryId: number,
    file: ScannedFile,
    parsed: ParsedColumns,
    now: number
  ): number {
    const row = this.sql
      .get(
        `INSERT INTO files (library_id, path, display_path, dir, name, kind, size,
           mtime, parsed, parser_version, state, added_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .get(
        libraryId,
        file.key,
        file.displayPath,
        file.dir,
        file.name,
        file.kind,
        file.size,
        file.mtime,
        parsed.parsed,
        parsed.parserVersion,
        parsed.state,
        now,
        now
      )!
    return Number(row.id)
  }

  /**
   * 更新已有文件的位置、大小、时间与解析结果。
   * 内容变了（大小或 mtime 不同）时清掉指纹，等指纹任务重算；时长与动态范围同理清空，之后重新探测。
   */
  updateFile(
    id: number,
    file: ScannedFile,
    parsed: ParsedColumns,
    now: number,
    fingerprint: string | null
  ): void {
    this.sql
      .get(
        `UPDATE files SET path = ?, display_path = ?, dir = ?, name = ?, size = ?,
           mtime = ?, parsed = ?, parser_version = ?, state = ?, updated_at = ?,
           fingerprint = ?,
           duration = CASE WHEN size = ? AND mtime = ? THEN duration END,
           video_range = CASE WHEN size = ? AND mtime = ? THEN video_range END
         WHERE id = ?`
      )
      .run(
        file.key,
        file.displayPath,
        file.dir,
        file.name,
        file.size,
        file.mtime,
        parsed.parsed,
        parsed.parserVersion,
        parsed.state,
        now,
        fingerprint,
        file.size,
        file.mtime,
        file.size,
        file.mtime,
        id
      )
  }

  /** 删除单个文件。 */
  deleteFile(id: number): void {
    this.sql.get('DELETE FROM files WHERE id = ?').run(id)
  }

  /** 写入指纹。 */
  setFingerprint(id: number, fingerprint: string): void {
    this.sql
      .get('UPDATE files SET fingerprint = ? WHERE id = ?')
      .run(fingerprint, id)
  }

  /** 一批还没有指纹的视频文件。 */
  unfingerprinted(
    libraryId: number,
    limit: number
  ): Array<{ id: number; displayPath: string }> {
    return this.sql
      .get(
        `SELECT id, display_path FROM files
         WHERE library_id = ? AND kind = 'video' AND fingerprint IS NULL
         ORDER BY id LIMIT ?`
      )
      .all(libraryId, limit)
      .map(r => ({ id: Number(r.id), displayPath: String(r.display_path) }))
  }

  /** 写入动态范围探测结果；probe 为 null 表示读不出视频流（记 ''，不再重试）。 */
  setVideoProbe(id: number, probe: VideoProbe | null): void {
    this.sql
      .get(
        'UPDATE files SET video_range = ?, dv_profile = ?, dv_compat = ? WHERE id = ?'
      )
      .run(
        probe?.range ?? '',
        probe?.dvProfile ?? null,
        probe?.dvCompat ?? null,
        id
      )
  }

  /** 一批还没探测动态范围的视频文件（id 大于 afterId，按 id 升序）。 */
  unprobed(
    libraryId: number,
    afterId: number,
    limit: number
  ): Array<{ id: number; displayPath: string }> {
    return this.sql
      .get(
        `SELECT id, display_path FROM files
         WHERE library_id = ? AND kind = 'video' AND video_range IS NULL AND id > ?
         ORDER BY id LIMIT ?`
      )
      .all(libraryId, afterId, limit)
      .map(r => ({ id: Number(r.id), displayPath: String(r.display_path) }))
  }

  /** 一批解析版本落后的视频文件（id 大于 afterId，按 id 升序）。 */
  staleParsed(
    libraryId: number,
    parserVersion: number,
    afterId: number,
    limit: number
  ): Array<{ id: number; key: string; displayPath: string }> {
    return this.sql
      .get(
        `SELECT id, path, display_path FROM files
         WHERE library_id = ? AND kind = 'video' AND parser_version < ? AND id > ?
         ORDER BY id LIMIT ?`
      )
      .all(libraryId, parserVersion, afterId, limit)
      .map(r => ({
        id: Number(r.id),
        key: String(r.path),
        displayPath: String(r.display_path),
      }))
  }

  /** 只更新解析结果。 */
  setParsed(id: number, parsed: ParsedColumns, now: number): void {
    this.sql
      .get(
        'UPDATE files SET parsed = ?, parser_version = ?, state = ?, updated_at = ? WHERE id = ?'
      )
      .run(parsed.parsed, parsed.parserVersion, parsed.state, now, id)
  }
}
