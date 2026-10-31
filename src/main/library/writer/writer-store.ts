/**
 * 写出层的数据库读写：写出记录（writer_outputs）、条目写出时间、整理批次与日志、
 * 以及整理后 files 表的路径更新。写方法都应在调用方的事务里执行（单条语句的除外）。
 */
import { basename, dirname } from 'node:path'
import type {
  OrganizeBatchInfo,
  OrganizeBatchState,
  OrganizeEntryKind,
} from '../../../shared/library/ipc'
import { type LibraryDb, StatementCache } from '../db/database'
import type { LibraryRecord } from '../libraries/library-store'
import { parseLibraryFile } from '../scanner/parse'
import { pathKey, subtreeRange } from '../scanner/rules'
import type { FieldSnapshot } from './nfo/nfo-merge'

/** 一条写出记录。 */
export interface OutputRecord {
  hash: string
  size: number
  mtime: number
  fields: FieldSnapshot | null
}

/** 一条整理日志。 */
export interface OrganizeOp {
  seq: number
  itemId: number
  libraryId: number
  kind: OrganizeEntryKind
  src: string
  dst: string
  crossDevice: boolean
  state: 'pending' | 'done' | 'failed' | 'skipped' | 'undone'
}

/** 写出层仓库。 */
export class WriterStore {
  private readonly sql: StatementCache

  constructor(db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  // —————————————————————————— 写出记录 ——————————————————————————

  /** 某路径的写出记录。 */
  output(path: string): OutputRecord | undefined {
    const row = this.sql
      .get(
        'SELECT hash, size, mtime, fields FROM writer_outputs WHERE path = ?'
      )
      .get(pathKey(path))
    if (!row) return undefined
    return {
      hash: String(row.hash),
      size: Number(row.size),
      mtime: Number(row.mtime),
      fields:
        row.fields === null
          ? null
          : (JSON.parse(String(row.fields)) as FieldSnapshot),
    }
  }

  /** 记录一次写出（或确认磁盘内容就是我们要写的）。 */
  putOutput(
    path: string,
    itemId: number,
    kind: 'nfo' | 'image',
    record: OutputRecord,
    now: number
  ): void {
    this.sql
      .get(
        `INSERT INTO writer_outputs (path, item_id, kind, hash, size, mtime, fields, written_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET item_id = excluded.item_id,
           kind = excluded.kind, hash = excluded.hash, size = excluded.size,
           mtime = excluded.mtime, fields = excluded.fields, written_at = excluded.written_at`
      )
      .run(
        pathKey(path),
        itemId,
        kind,
        record.hash,
        record.size,
        record.mtime,
        record.fields ? JSON.stringify(record.fields) : null,
        now
      )
  }

  /** 标记条目写出完成。 */
  markWritten(itemId: number, now: number): void {
    this.sql
      .get('UPDATE media_items SET written_at = ? WHERE id = ?')
      .run(now, itemId)
  }

  // —————————————————————————— 条目与目录 ——————————————————————————

  /** 把任意条目 id 换成所属顶层条目（电影 / 剧集）id，去重保序；不存在的忽略。 */
  topLevelIds(ids: number[]): number[] {
    const rows = this.sql
      .get(
        `SELECT j.key AS k, COALESCE(gp.id, p.id, i.id) AS top
         FROM json_each(?) j
         JOIN media_items i ON i.id = j.value
         LEFT JOIN media_items p ON p.id = i.parent_id
         LEFT JOIN media_items gp ON gp.id = p.parent_id
         ORDER BY j.key`
      )
      .all(JSON.stringify(ids))
    return [...new Set(rows.map(r => Number(r.top)))]
  }

  /** 条目所在媒体库 id。 */
  libraryOf(itemId: number): number | undefined {
    const row = this.sql
      .get('SELECT library_id FROM media_items WHERE id = ?')
      .get(itemId)
    return row ? Number(row.library_id) : undefined
  }

  /** 某目录里属于其他顶层条目的视频（系统路径）。用来判断电影是否独占文件夹。 */
  foreignVideosIn(dir: string, topItemId: number): string[] {
    return this.sql
      .get(
        `SELECT DISTINCT f.display_path FROM files f
         JOIN file_media fm ON fm.file_id = f.id
         JOIN media_items i ON i.id = fm.item_id
         LEFT JOIN media_items p ON p.id = i.parent_id
         LEFT JOIN media_items gp ON gp.id = p.parent_id
         WHERE f.dir = ? AND f.kind = 'video'
           AND COALESCE(gp.id, p.id, i.id) <> ?`
      )
      .all(pathKey(dir), topItemId)
      .map(r => String(r.display_path))
  }

  // —————————————————————————— 整理后更新路径 ——————————————————————————

  /**
   * 文件（或目录）移动后同步 files 表：保留 id、关联与匹配，只改路径与解析结果
   * （与扫描器识别出的移动同样处理）。目录移动时更新整棵子树，旧目录记录交给下次扫描回收。
   * stat 是移动后的新文件状态（跨盘复制后 mtime 精度可能变化，以新值为准，扫描不会误判为内容变化）。
   */
  relocate(
    library: LibraryRecord,
    from: string,
    to: string,
    isDirectory: boolean,
    stat: { size: number; mtime: number } | null,
    now: number
  ): void {
    const fromKey = pathKey(from)
    const toKey = pathKey(to)
    if (fromKey !== toKey) {
      const outputs = isDirectory
        ? this.sql
            .get('SELECT path FROM writer_outputs WHERE path > ? AND path < ?')
            .all(...subtreeRange(fromKey))
        : this.sql
            .get('SELECT path FROM writer_outputs WHERE path = ?')
            .all(fromKey)
      for (const output of outputs) {
        const oldPath = String(output.path)
        const nextPath = toKey + oldPath.slice(fromKey.length)
        this.sql.get('DELETE FROM writer_outputs WHERE path = ?').run(nextPath)
        this.sql
          .get(
            `UPDATE writer_outputs SET path = ?, size = COALESCE(?, size), mtime = COALESCE(?, mtime) WHERE path = ?`
          )
          .run(
            nextPath,
            isDirectory ? null : (stat?.size ?? null),
            isDirectory ? null : (stat?.mtime ?? null),
            oldPath
          )
      }
    }
    if (isDirectory) {
      const fromKey = pathKey(from)
      const rows = this.sql
        .get(
          'SELECT id, kind, display_path, media_kind_override FROM files WHERE path > ? AND path < ?'
        )
        .all(...subtreeRange(fromKey))
      for (const row of rows) {
        const suffix = String(row.display_path).slice(from.length)
        this.relocateRow(library, row, `${to}${suffix}`, null, now)
      }
      this.sql
        .get('DELETE FROM dirs WHERE path = ? OR (path > ? AND path < ?)')
        .run(fromKey, ...subtreeRange(fromKey))
      return
    }
    const row = this.sql
      .get('SELECT id, kind, media_kind_override FROM files WHERE path = ?')
      .get(pathKey(from))
    if (row) this.relocateRow(library, row, to, stat, now)
  }

  private relocateRow(
    library: LibraryRecord,
    row: Record<string, unknown>,
    to: string,
    stat: { size: number; mtime: number } | null,
    now: number
  ): void {
    const id = Number(row.id)
    const key = pathKey(to)
    const { columns } = parseLibraryFile(
      {
        libraryId: library.id,
        kind: library.kind,
        mixed: library.mixed,
        overrideKind:
          row.media_kind_override === 'movie' ||
          row.media_kind_override === 'tv'
            ? row.media_kind_override
            : undefined,
        rootKey: library.rootKey,
        source: library.source,
      },
      { key, displayPath: to, kind: String(row.kind) }
    )
    // 目标路径上若残留旧记录（之前删掉、扫描还没回收），先清掉，避免唯一索引冲突
    this.sql.get('DELETE FROM files WHERE path = ? AND id <> ?').run(key, id)
    this.sql
      .get(
        `UPDATE files SET path = ?, display_path = ?, dir = ?, name = ?,
           parsed = ?, parser_version = ?, state = ?, updated_at = ?,
           size = COALESCE(?, size), mtime = COALESCE(?, mtime)
         WHERE id = ?`
      )
      .run(
        key,
        to,
        pathKey(dirname(to)),
        basename(to),
        columns.parsed,
        columns.parserVersion,
        columns.state,
        now,
        stat?.size ?? null,
        stat?.mtime ?? null,
        id
      )
  }

  // —————————————————————————— 整理批次 ——————————————————————————

  /** 新建批次并写入全部待执行项，返回批次 id。 */
  createBatch(
    itemIds: number[],
    ops: Array<Omit<OrganizeOp, 'seq' | 'state'>>,
    now: number
  ): number {
    const batch = this.sql
      .get(
        `INSERT INTO organize_batches (state, item_ids, total, created_at)
         VALUES ('running', ?, ?, ?) RETURNING id`
      )
      .get(JSON.stringify(itemIds), ops.length, now)!
    const batchId = Number(batch.id)
    const insert = this.sql.get(
      `INSERT INTO organize_ops (batch_id, seq, item_id, library_id, kind, src, dst, cross_device)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    ops.forEach((op, seq) =>
      insert.run(
        batchId,
        seq,
        op.itemId,
        op.libraryId,
        op.kind,
        op.src,
        op.dst,
        op.crossDevice ? 1 : 0
      )
    )
    return batchId
  }

  /** 批次的全部日志，按 seq 升序。 */
  ops(batchId: number): OrganizeOp[] {
    return this.sql
      .get(
        `SELECT seq, item_id, library_id, kind, src, dst, cross_device, state
         FROM organize_ops WHERE batch_id = ? ORDER BY seq`
      )
      .all(batchId)
      .map(r => ({
        seq: Number(r.seq),
        itemId: Number(r.item_id),
        libraryId: Number(r.library_id),
        kind: r.kind as OrganizeEntryKind,
        src: String(r.src),
        dst: String(r.dst),
        crossDevice: Number(r.cross_device) === 1,
        state: r.state as OrganizeOp['state'],
      }))
  }

  /** 更新一项的状态。 */
  setOpState(
    batchId: number,
    seq: number,
    state: OrganizeOp['state'],
    error: string | null = null
  ): void {
    this.sql
      .get(
        'UPDATE organize_ops SET state = ?, error = ? WHERE batch_id = ? AND seq = ?'
      )
      .run(state, error, batchId, seq)
  }

  /** 更新批次状态。 */
  setBatchState(
    batchId: number,
    state: OrganizeBatchState,
    fields: {
      finishedAt?: number
      undoneAt?: number
      error?: string | null
    } = {}
  ): void {
    this.sql
      .get(
        `UPDATE organize_batches SET state = ?,
           finished_at = COALESCE(?, finished_at), undone_at = COALESCE(?, undone_at),
           error = CASE WHEN ? THEN ? ELSE error END
         WHERE id = ?`
      )
      .run(
        state,
        fields.finishedAt ?? null,
        fields.undoneAt ?? null,
        fields.error !== undefined ? 1 : 0,
        fields.error ?? null,
        batchId
      )
  }

  /** 单个批次；不存在返回 undefined。 */
  batch(batchId: number): OrganizeBatchInfo | undefined {
    return this.batches(batchId)[0]
  }

  /** 最近的批次（新的在前），或指定的一个。 */
  batches(batchId?: number, limit = 50): OrganizeBatchInfo[] {
    const where = batchId === undefined ? '' : 'WHERE b.id = ?'
    const params = batchId === undefined ? [limit] : [batchId, limit]
    return this.sql
      .get(
        `SELECT b.*,
           (SELECT COUNT(*) FROM organize_ops o WHERE o.batch_id = b.id AND o.state IN ('done', 'undone')) AS moved,
           (SELECT COUNT(*) FROM organize_ops o WHERE o.batch_id = b.id AND o.state = 'failed') AS failed
         FROM organize_batches b ${where} ORDER BY b.id DESC LIMIT ?`
      )
      .all(...params)
      .map(r => ({
        batchId: Number(r.id),
        state: r.state as OrganizeBatchState,
        createdAt: Number(r.created_at),
        finishedAt: r.finished_at === null ? null : Number(r.finished_at),
        undoneAt: r.undone_at === null ? null : Number(r.undone_at),
        total: Number(r.total),
        moved: Number(r.moved),
        failed: Number(r.failed),
        itemIds: JSON.parse(String(r.item_ids)) as number[],
        error: r.error === null ? null : String(r.error),
      }))
  }
}
