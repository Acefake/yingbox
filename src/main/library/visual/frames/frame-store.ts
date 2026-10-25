/**
 * 视频关键帧的仓库：可抽帧的视频文件、每个文件的抽帧进度（visual_frames）与帧向量
 * （visual_vectors 里 source = 'frame' 的行，见 db/schema-visual.ts 的 V9）。
 */
import type { LibrarySource } from '../../../../shared/library/ipc'
import { type LibraryDb, StatementCache, transaction } from '../../db/database'
import { CLIP_DIM } from '../clip-encoder'
import { type QuantizedVector, packVector, unpackVector } from '../visual-rules'

/** 一个可抽帧的视频文件，带已存的进度。 */
export interface FrameFile {
  fileId: number
  itemId: number
  libraryId: number
  /** 系统路径（给 ffmpeg）。 */
  path: string
  size: number
  mtime: number
  /** 扫描 / 识别时探测到的时长（秒）；没探测过为 null。 */
  duration: number | null
  stored: {
    itemId: number
    signature: string
    state: 'running' | 'done' | 'error'
    nextIndex: number
  } | null
}

/** 一行要写入的帧向量。 */
export interface FrameRow {
  /** 帧缩略图地址（yingbox-media://image/<key>）。 */
  image: string
  atMs: number
  vec: QuantizedVector
}

export class FrameStore {
  private readonly sql: StatementCache

  constructor(private readonly db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  /** 某来源下已识别电影的全部视频文件（按条目、文件排序）。 */
  files(source: LibrarySource): FrameFile[] {
    const rows = this.sql
      .get(
        `SELECT f.id AS file_id, fm.item_id, i.library_id, f.display_path, f.size,
                f.mtime, f.duration, vf.item_id AS stored_item, vf.signature,
                vf.state, vf.next_index
         FROM files f
         JOIN file_media fm ON fm.file_id = f.id
         JOIN media_items i ON i.id = fm.item_id
         JOIN libraries l ON l.id = i.library_id
         LEFT JOIN visual_frames vf ON vf.file_id = f.id
         WHERE f.kind = 'video' AND l.source = ? AND i.type = 'movie'
           AND i.metadata IS NOT NULL
         ORDER BY i.id, f.id`
      )
      .all(source)
    return rows.map(row => ({
      fileId: Number(row.file_id),
      itemId: Number(row.item_id),
      libraryId: Number(row.library_id),
      path: String(row.display_path),
      size: Number(row.size),
      mtime: Number(row.mtime),
      duration: row.duration === null ? null : Number(row.duration),
      stored:
        row.signature === null
          ? null
          : {
              itemId: Number(row.stored_item),
              signature: String(row.signature),
              state: String(row.state) as 'running' | 'done' | 'error',
              nextIndex: Number(row.next_index),
            },
    }))
  }

  /** 已入库的帧数。 */
  frameCount(): number {
    const row = this.sql
      .get("SELECT COUNT(*) AS n FROM visual_vectors WHERE source = 'frame'")
      .get()
    return Number(row?.n ?? 0)
  }

  /**
   * 从头开始抽一个文件：清掉它的旧帧，进度记为第 0 帧。返回旧帧的缩略图地址（调用方删文件）。
   */
  begin(
    file: Pick<FrameFile, 'fileId' | 'itemId'>,
    model: string,
    signature: string,
    planned: number,
    now = Date.now()
  ): string[] {
    return transaction(this.db, () => {
      const old = this.sql
        .get('SELECT image FROM visual_vectors WHERE file_id = ?')
        .all(file.fileId)
        .map(r => String(r.image))
      this.sql
        .get('DELETE FROM visual_vectors WHERE file_id = ?')
        .run(file.fileId)
      this.sql
        .get(
          `INSERT INTO visual_frames (file_id, item_id, model, signature, planned,
             next_index, state, error, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, 'running', NULL, ?)
           ON CONFLICT (file_id) DO UPDATE SET item_id = excluded.item_id,
             model = excluded.model, signature = excluded.signature,
             planned = excluded.planned, next_index = 0, state = 'running',
             error = NULL, updated_at = excluded.updated_at`
        )
        .run(file.fileId, file.itemId, model, signature, planned, now)
      return old
    })
  }

  /** 一批帧入库并推进进度；done 时文件标记抽完。 */
  saveBatch(
    file: Pick<FrameFile, 'fileId' | 'itemId'>,
    rows: readonly FrameRow[],
    nextIndex: number,
    done: boolean,
    now = Date.now()
  ): void {
    transaction(this.db, () => {
      const insert = this.sql.get(
        `INSERT OR REPLACE INTO visual_vectors (item_id, image, vec, source, file_id, at_ms)
         VALUES (?, ?, ?, 'frame', ?, ?)`
      )
      for (const r of rows)
        insert.run(file.itemId, r.image, packVector(r.vec), file.fileId, r.atMs)
      this.sql
        .get(
          `UPDATE visual_frames SET next_index = ?, state = ?, updated_at = ?
           WHERE file_id = ?`
        )
        .run(nextIndex, done ? 'done' : 'running', now, file.fileId)
    })
  }

  /** 这个文件抽不了（读不到时长等）：记下原因，文件不变就不再试。 */
  fail(fileId: number, error: string, now = Date.now()): void {
    this.sql
      .get(
        `UPDATE visual_frames SET state = 'error', error = ?, updated_at = ?
         WHERE file_id = ?`
      )
      .run(error, now, fileId)
  }

  /** 续跑时上一张保留的帧（反量化成 float，和新帧比相似度）；没有返回 null。 */
  lastKept(fileId: number): Float32Array | null {
    const row = this.sql
      .get(
        `SELECT vec FROM visual_vectors WHERE file_id = ?
         ORDER BY at_ms DESC LIMIT 1`
      )
      .get(fileId)
    if (!row) return null
    const q = new Int8Array(CLIP_DIM)
    const scale = unpackVector(row.vec as Uint8Array, q, 0)
    return Float32Array.from(q, x => x * scale)
  }

  /** 除了抽帧任务自己，还有没有在跑或到期待跑的任务（有就让出）。 */
  othersBusy(type: string, now = Date.now()): boolean {
    return Boolean(
      this.sql
        .get(
          `SELECT 1 FROM jobs WHERE type <> ? AND (state = 'running'
             OR (state = 'queued' AND run_after <= ?)) LIMIT 1`
        )
        .get(type, now)
    )
  }
}
