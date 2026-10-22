/**
 * 按画面搜的向量仓库（visual_vectors / visual_items，见 db/schema-visual.ts）。
 */
import type { ItemMetadata, LibrarySource } from '../../../shared/library/ipc'
import { type LibraryDb, StatementCache, transaction } from '../db/database'
import { CLIP_DIM } from './clip-encoder'
import {
  type QuantizedVector,
  imageSignature,
  indexImages,
  packVector,
  unpackVector,
} from './visual-rules'

/** 待索引的条目。 */
export interface VisualCandidate {
  itemId: number
  images: string[]
  signature: string
}

/** 全部向量（内存检索用）：第 i 行属于 itemIds[i]、来自 images[i]。 */
export interface VisualMatrix {
  itemIds: Int32Array
  images: string[]
  vectors: Int8Array
  /** 每行的量化缩放系数。 */
  scales: Float32Array
}

export class VisualStore {
  private readonly sql: StatementCache

  constructor(private readonly db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  /** 某来源下有元数据、有可索引图片的电影，带已存的签名。 */
  private titles(
    source: LibrarySource
  ): Array<{ itemId: number; images: string[]; stored: string | null }> {
    const rows = this.sql
      .get(
        `SELECT i.id, i.metadata, v.signature AS stored
         FROM media_items i
         JOIN libraries l ON l.id = i.library_id
         LEFT JOIN visual_items v ON v.item_id = i.id
         WHERE l.source = ? AND i.type = 'movie' AND i.metadata IS NOT NULL`
      )
      .all(source)
    return rows.flatMap(row => {
      const images = indexImages(
        JSON.parse(String(row.metadata)) as ItemMetadata
      )
      if (!images.length) return []
      return [
        {
          itemId: Number(row.id),
          images,
          stored: row.stored === null ? null : String(row.stored),
        },
      ]
    })
  }

  /** 需要（重新）索引的条目。 */
  candidates(source: LibrarySource, model: string): VisualCandidate[] {
    return this.titles(source)
      .map(t => ({ ...t, signature: imageSignature(model, t.images) }))
      .filter(t => t.stored !== t.signature)
      .map(({ itemId, images, signature }) => ({ itemId, images, signature }))
  }

  /** 某来源下有封面或剧照的电影数与已用当前模型索引的条目数（纯 SQL，状态轮询用）。 */
  counts(
    source: LibrarySource,
    model: string
  ): { total: number; indexed: number } {
    const row = this.sql
      .get(
        `SELECT COUNT(*) AS total, COUNT(v.item_id) AS indexed
         FROM media_items i
         JOIN libraries l ON l.id = i.library_id
         LEFT JOIN visual_items v ON v.item_id = i.id AND v.model = ?
         WHERE l.source = ? AND i.type = 'movie' AND i.metadata IS NOT NULL
           AND EXISTS (SELECT 1 FROM json_each(i.metadata, '$.images') j
             WHERE json_extract(j.value, '$.role') IN ('backdrop', 'still'))`
      )
      .get(model, source)
    return {
      total: Number(row?.total ?? 0),
      indexed: Number(row?.indexed ?? 0),
    }
  }

  /** 是否有任何已索引的条目（用户启用过按画面搜）。 */
  any(): boolean {
    return Boolean(this.sql.get('SELECT 1 FROM visual_items LIMIT 1').get())
  }

  /** 条目片名（搜索结果用）。 */
  titlesOf(itemIds: readonly number[]): Map<number, string> {
    if (!itemIds.length) return new Map()
    const marks = itemIds.map(() => '?').join(', ')
    const rows = this.db
      .prepare(`SELECT id, title FROM media_items WHERE id IN (${marks})`)
      .all(...itemIds)
    return new Map(rows.map(r => [Number(r.id), String(r.title)]))
  }

  /** 范围内（来源、可选媒体库）的条目 id。 */
  scope(source: LibrarySource, libraryId?: number): Set<number> {
    const rows = this.sql
      .get(
        `SELECT v.item_id AS id FROM visual_items v
         JOIN media_items i ON i.id = v.item_id
         JOIN libraries l ON l.id = i.library_id
         WHERE l.source = ? AND (? IS NULL OR i.library_id = ?)`
      )
      .all(source, libraryId ?? null, libraryId ?? null)
    return new Set(rows.map(r => Number(r.id)))
  }

  /** 写入一个条目的向量（整体替换）。 */
  save(
    itemId: number,
    model: string,
    signature: string,
    vectors: ReadonlyArray<{ image: string; vec: QuantizedVector }>,
    now = Date.now()
  ): void {
    transaction(this.db, () => {
      this.sql.get('DELETE FROM visual_vectors WHERE item_id = ?').run(itemId)
      const insert = this.sql.get(
        'INSERT INTO visual_vectors (item_id, image, vec) VALUES (?, ?, ?)'
      )
      for (const v of vectors) insert.run(itemId, v.image, packVector(v.vec))
      this.sql
        .get(
          `INSERT INTO visual_items (item_id, model, signature, images, indexed_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (item_id) DO UPDATE SET model = excluded.model,
             signature = excluded.signature, images = excluded.images,
             indexed_at = excluded.indexed_at`
        )
        .run(itemId, model, signature, vectors.length, now)
    })
  }

  /** 读出全部向量。 */
  matrix(model: string): VisualMatrix {
    const rows = this.sql
      .get(
        `SELECT v.item_id, v.image, v.vec FROM visual_vectors v
         JOIN visual_items s ON s.item_id = v.item_id
         WHERE s.model = ?`
      )
      .all(model)
    const itemIds = new Int32Array(rows.length)
    const images: string[] = []
    const vectors = new Int8Array(rows.length * CLIP_DIM)
    const scales = new Float32Array(rows.length)
    rows.forEach((row, i) => {
      itemIds[i] = Number(row.item_id)
      images.push(String(row.image))
      scales[i] = unpackVector(row.vec as Uint8Array, vectors, i)
    })
    return { itemIds, images, vectors, scales }
  }
}
